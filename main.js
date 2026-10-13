const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const RiotAPI = require('./src/riot-api');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const AUTH_PATH = path.join(__dirname, 'auth.json');
const GITHUB_REPO = 'supidooo/valorant-instalock';
const CURRENT_VERSION = require('./package.json').version || '1.0.0';

// Evitar bloqueio e erros de cache de disco/GPU do Chromium no Windows
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-program-cache');

function compareVersions(v1, v2) {
  const clean1 = (v1 || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const clean2 = (v2 || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(clean1.length, clean2.length); i++) {
    const num1 = clean1[i] || 0;
    const num2 = clean2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

async function checkForAppUpdates() {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Valorant-Instalock-App',
        'Accept': 'application/vnd.github.v3+json'
      },
      timeout: 5000
    });

    const latestRelease = res.data;
    const latestTag = latestRelease.tag_name || latestRelease.name || '';

    if (compareVersions(latestTag, CURRENT_VERSION) > 0) {
      sendLog('info', `Nova atualização detectada no GitHub: ${latestTag} (Versão instalada: v${CURRENT_VERSION})`);

      const updateData = {
        version: latestTag.replace(/^v/, ''),
        tag: latestTag,
        releaseName: latestRelease.name || latestTag,
        releaseUrl: latestRelease.html_url,
        notes: latestRelease.body || '',
        publishedAt: latestRelease.published_at,
        assets: (latestRelease.assets || []).map(a => ({
          name: a.name,
          downloadUrl: a.browser_download_url,
          size: a.size
        }))
      };

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:update-available', updateData);
      }
      return updateData;
    } else {
      sendLog('info', `Aplicativo na versão mais recente (v${CURRENT_VERSION}).`);
    }
  } catch (err) {
    if (err.response?.status !== 404) {
      console.warn('Verificação de atualização GitHub:', err.message);
    }
  }
  return null;
}

// Garantir instância única para evitar concorrência de arquivos de cache
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const DEFAULT_CONFIG = {
  autoLockEnabled: true,
  lockDelayMs: 1200,
  region: 'br',
  mapAgents: {
    '/Game/Maps/Ascent/Ascent': '5f8d3d21-4a40-ab82-4949-c477f30009d8', // Breach no Ascent por padrão
  }
};

let mainWindow = null;
let authWebWindow = null;
let riotApi = new RiotAPI();
let config = { ...DEFAULT_CONFIG };
let pollingInterval = null;
let cachedGameData = null;
let isSilentLoginRunning = false;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      config = Object.assign({}, DEFAULT_CONFIG, JSON.parse(data));
    } else {
      saveConfig(DEFAULT_CONFIG);
    }
  } catch (err) {
    console.error('Erro ao carregar config:', err);
    config = { ...DEFAULT_CONFIG };
  }
}

function saveConfig(newConfig) {
  try {
    config = { ...config, ...newConfig };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Erro ao salvar config:', err);
    return false;
  }
}

function loadAuth() {
  try {
    if (fs.existsSync(AUTH_PATH)) {
      const data = fs.readFileSync(AUTH_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Erro ao ler auth.json:', err);
  }
  return null;
}

function saveAuth(authData) {
  try {
    fs.writeFileSync(AUTH_PATH, JSON.stringify(authData, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Erro ao salvar auth.json:', err);
    return false;
  }
}

function clearAuth() {
  try {
    if (fs.existsSync(AUTH_PATH)) {
      fs.unlinkSync(AUTH_PATH);
    }
  } catch (err) {
    console.error('Erro ao deletar auth.json:', err);
  }
}

async function syncCookiesToPartition(cookieStrings) {
  if (!cookieStrings || !cookieStrings.length) return;
  try {
    const riotSession = session.fromPartition('persist:riot');
    for (const cookieStr of cookieStrings) {
      const parts = cookieStr.split(';');
      const [nameVal] = parts;
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx > 0) {
        const name = nameVal.substring(0, eqIdx).trim();
        const value = nameVal.substring(eqIdx + 1).trim();
        await riotSession.cookies.set({
          url: 'https://auth.riotgames.com',
          name,
          value,
          domain: '.riotgames.com',
          path: '/',
          secure: true,
          httpOnly: true
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('Erro ao sincronizar cookies para persist:riot:', err.message);
  }
}

function sendLog(type, message) {
  const timestamp = new Date().toLocaleTimeString('pt-BR');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:log', { type, message, timestamp });
  }
  console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
}

function sendStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:status', status);
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.png');
  const windowOpts = {
    width: 1220,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#0b1118',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  };
  if (fs.existsSync(iconPath)) {
    windowOpts.icon = iconPath;
  }
  mainWindow = new BrowserWindow(windowOpts);

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    if (riotApi.accessToken) {
      mainWindow.webContents.send('app:auth-success', riotApi.getState());
    }
    setTimeout(() => {
      checkForAppUpdates();
    }, 1500);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Inicializar Monitoramento em Segundo Plano
function startMonitor() {
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    if (!riotApi.accessToken || !config.autoLockEnabled) return;

    try {
      const pregamePlayer = await riotApi.checkPreGamePlayer();

      if (pregamePlayer && pregamePlayer.MatchID) {
        const matchId = pregamePlayer.MatchID;

        // Se já trancou nesta mesma partida, aguardar ela finalizar
        if (riotApi.lastLockedMatchId === matchId) {
          sendStatus({ state: 'pregame_locked', text: 'Partida em andamento (Agente já trancado)' });
          return;
        }

        sendStatus({ state: 'pregame_detected', text: 'Partida encontrada! Analisando mapa...' });
        sendLog('info', `Partida encontrada! MatchID: ${matchId}`);

        // Obter detalhes da partida
        const matchDetails = await riotApi.getPreGameMatch(matchId);
        const mapUrl = matchDetails.MapID;

        // Descobrir nome amigável do mapa
        const mapInfo = cachedGameData?.maps?.find(m => m.mapUrl === mapUrl);
        const mapName = mapInfo ? mapInfo.displayName : mapUrl;

        sendLog('info', `Mapa detectado: ${mapName} (${mapUrl})`);

        // Verificar agente configurado para este mapa
        const targetAgentUuid = config.mapAgents[mapUrl];

        if (targetAgentUuid) {
          const agentInfo = cachedGameData?.agents?.find(a => a.uuid === targetAgentUuid);
          const agentName = agentInfo ? agentInfo.displayName : 'Agente configurado';

          if (config.lockDelayMs > 0) {
            sendLog('info', `Aguardando delay seguro de ${config.lockDelayMs}ms antes de trancar...`);
            await new Promise(r => setTimeout(r, config.lockDelayMs));
          }

          sendLog('action', `Disparando instalock para: ${agentName}...`);

          try {
            await riotApi.lockAgent(matchId, targetAgentUuid);
            riotApi.lastLockedMatchId = matchId;
            sendLog('success', `✅ SUCESSO: ${agentName} trancado automaticamente no mapa ${mapName}!`);
            sendStatus({ state: 'pregame_locked', text: `Trancado: ${agentName} (${mapName})` });
          } catch (lockErr) {
            sendLog('error', `Falha ao trancar agente: ${lockErr.response?.data?.message || lockErr.message}`);
          }
        } else {
          sendLog('warn', `Nenhum agente configurado para o mapa ${mapName}. Instalock ignorado.`);
          riotApi.lastLockedMatchId = matchId;
          sendStatus({ state: 'pregame_nolock', text: `Partida iniciada no mapa ${mapName} (Sem agente configurado)` });
        }
      } else {
        // Não está em pré-jogo
        if (riotApi.lastLockedMatchId) {
          riotApi.lastLockedMatchId = null;
        }
        sendStatus({ state: 'idle', text: 'Conectado à nuvem. Aguardando partida...' });
      }
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        sendLog('warn', 'Token de acesso expirou. Tentando renovação silenciosa...');
        const renewed = await attemptSilentLogin();
        if (!renewed) {
          sendLog('warn', 'Sessão expirada. Faça login novamente.');
          sendStatus({ state: 'disconnected', text: 'Sessão expirada' });
          riotApi.accessToken = null;
          clearAuth();
        }
      }
    }
  }, 1200);
}

// Tentativa de login silencioso usando cookies armazenados na partição persistente
async function attemptSilentLogin() {
  if (isSilentLoginRunning) return false;
  isSilentLoginRunning = true;

  return new Promise((resolve) => {
    let resolved = false;
    let silentWindow = null;
    let timeoutId = null;

    function cleanup(result) {
      if (resolved) return;
      resolved = true;
      isSilentLoginRunning = false;
      if (timeoutId) clearTimeout(timeoutId);
      if (silentWindow && !silentWindow.isDestroyed()) {
        silentWindow.destroy();
        silentWindow = null;
      }
      resolve(result);
    }

    try {
      silentWindow = new BrowserWindow({
        show: false,
        width: 500,
        height: 600,
        webPreferences: {
          partition: 'persist:riot',
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      const loginUrl = 'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&scope=account%20openid&nonce=1&ui_locales=pt-BR';

      async function handleUrl(url) {
        if (!url || resolved) return;

        if (url.includes('access_token=') && url.includes('id_token=')) {
          try {
            const authResult = await riotApi.extractAndSetTokensFromUri(url);

            const riotSession = session.fromPartition('persist:riot');
            const cookies = await riotSession.cookies.get({ domain: 'riotgames.com' });
            riotApi.sessionCookies = cookies.map(c => `${c.name}=${c.value}`);
            saveAuth(riotApi.getSessionData());

            sendLog('success', `Sessão Riot renovada com sucesso: ${authResult.gameName}#${authResult.tagLine}`);
            sendStatus({ state: 'idle', text: 'Conectado à nuvem. Aguardando partida...' });

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('app:auth-success', authResult);
            }

            startMonitor();
            cleanup(true);
          } catch (err) {
            sendLog('warn', `Falha ao processar tokens silenciosos: ${err.message}`);
            cleanup(false);
          }
        } else if (url.includes('auth.riotgames.com/login') || url.includes('/login?') || url.includes('error=')) {
          cleanup(false);
        }
      }

      silentWindow.webContents.on('will-redirect', (_, url) => handleUrl(url));
      silentWindow.webContents.on('will-navigate', (_, url) => handleUrl(url));
      silentWindow.webContents.on('did-navigate', (_, url) => handleUrl(url));
      silentWindow.webContents.on('did-redirect-navigation', (_, url) => handleUrl(url));

      silentWindow.loadURL(loginUrl).catch(() => cleanup(false));

      // Timeout limite de 8 segundos
      timeoutId = setTimeout(() => {
        cleanup(false);
      }, 8000);
    } catch (err) {
      console.error('Erro no silent login:', err);
      cleanup(false);
    }
  });
}

// Restaurar sessão salva ou reautenticar silenciosamente
async function restoreOrSilentLogin() {
  const savedAuth = loadAuth();
  if (savedAuth && savedAuth.accessToken) {
    sendLog('info', 'Verificando sessão salva...');
    const restored = await riotApi.restoreSession(savedAuth);
    if (restored) {
      sendLog('success', `Bem-vindo de volta, ${restored.gameName}#${restored.tagLine}!`);
      sendStatus({ state: 'idle', text: 'Conectado à nuvem. Aguardando partida...' });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:auth-success', restored);
      }
      startMonitor();
      return true;
    }
  }

  // Se não foi possível restaurar pelo token, tenta reautenticação silenciosa via cookies
  const silentSuccess = await attemptSilentLogin();
  if (!silentSuccess) {
    sendStatus({ state: 'disconnected', text: 'Não autenticado' });
  }
  return silentSuccess;
}

// Buscar Mapas e Agentes Oficiais via API Pública
async function fetchGameData(forceRefresh = false) {
  if (cachedGameData && !forceRefresh) return cachedGameData;

  try {
    const [agentsRes, mapsRes, contractsRes] = await Promise.all([
      axios.get('https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=pt-BR'),
      axios.get('https://valorant-api.com/v1/maps?language=pt-BR'),
      axios.get('https://valorant-api.com/v1/contracts').catch(() => ({ data: { data: [] } }))
    ]);

    // Mapear Contrato -> UUID do Agente
    const contractToAgent = {};
    if (contractsRes.data?.data) {
      contractsRes.data.data.forEach(c => {
        if (c.content?.relationType === 'Agent' && c.content?.relationUuid) {
          contractToAgent[c.uuid] = c.content.relationUuid;
        }
      });
    }

    // Buscar maestria real do jogador se logado
    let agentMastery = {};
    try {
      const playerContracts = await riotApi.fetchPlayerContracts();
      for (const [contractId, level] of Object.entries(playerContracts)) {
        const agentUuid = contractToAgent[contractId];
        if (agentUuid) {
          agentMastery[agentUuid] = level;
        }
      }
    } catch {}

    const agents = agentsRes.data.data.map(a => ({
      uuid: a.uuid,
      displayName: a.displayName,
      displayIcon: a.displayIcon,
      fullPortrait: a.fullPortrait || a.displayIcon,
      description: a.description || '',
      masteryLevel: agentMastery[a.uuid] || 1,
      role: {
        displayName: a.role ? a.role.displayName : 'Outro',
        displayIcon: a.role ? a.role.displayIcon : '',
        description: a.role ? a.role.description : ''
      }
    })).sort((a, b) => a.displayName.localeCompare(b.displayName));

    const competitiveMaps = [
      'Ascent', 'Bind', 'Haven', 'Split', 'Icebox', 'Breeze',
      'Fracture', 'Pearl', 'Lotus', 'Sunset', 'Abyss', 'Corrode'
    ];

    const maps = mapsRes.data.data
      .filter(m => m.tacticalDescription !== null || competitiveMaps.includes(m.displayName))
      .map(m => ({
        uuid: m.uuid,
        displayName: m.displayName,
        mapUrl: m.mapUrl,
        splash: m.splash,
        listViewIcon: m.listViewIcon
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    cachedGameData = { agents, maps };
    return cachedGameData;
  } catch (err) {
    console.error('Falha ao buscar dados do jogo:', err.message);
    return { agents: [], maps: [] };
  }
}

// Configurar IPC Handlers
function setupIpc() {
  ipcMain.handle('auth:login-credentials', async (_, { username, password }) => {
    try {
      sendLog('info', `Iniciando autenticação para ${username}...`);
      const result = await riotApi.loginWithCredentials(username, password);

      if (result.status === 'authenticated') {
        saveAuth(riotApi.getSessionData());
        await syncCookiesToPartition(riotApi.sessionCookies);
        sendLog('success', `Conectado com sucesso como ${result.gameName}#${result.tagLine} (Região: ${result.region.toUpperCase()})`);
        startMonitor();
        return { success: true, ...result };
      } else if (result.status === '2fa_required') {
        sendLog('info', `Código de verificação (2FA) solicitado para: ${result.email}`);
        return { success: false, need2fa: true, email: result.email };
      }
    } catch (err) {
      sendLog('error', `Falha no login: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:submit-2fa', async (_, { code }) => {
    try {
      sendLog('info', `Verificando código 2FA...`);
      const result = await riotApi.submit2FACode(code);
      if (result.status === 'authenticated') {
        saveAuth(riotApi.getSessionData());
        await syncCookiesToPartition(riotApi.sessionCookies);
        sendLog('success', `2FA verificado! Conectado como ${result.gameName}#${result.tagLine}`);
        startMonitor();
        return { success: true, ...result };
      }
    } catch (err) {
      sendLog('error', `Falha no 2FA: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:open-webview', async () => {
    if (authWebWindow) {
      authWebWindow.focus();
      return;
    }

    const iconPath = path.join(__dirname, 'icon.png');
    const authOpts = {
      width: 520,
      height: 740,
      minWidth: 440,
      minHeight: 600,
      title: 'Login Oficial Riot Games',
      parent: mainWindow,
      modal: true,
      backgroundColor: '#111111',
      webPreferences: {
        partition: 'persist:riot',
        nodeIntegration: false,
        contextIsolation: true
      }
    };
    if (fs.existsSync(iconPath)) {
      authOpts.icon = iconPath;
    }
    authWebWindow = new BrowserWindow(authOpts);
    authWebWindow.setMenuBarVisibility(false);

    const loginUrl = 'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&scope=account%20openid&nonce=1&ui_locales=pt-BR';
    
    authWebWindow.loadURL(loginUrl);

    let isHandlingSuccess = false;

    async function checkNavigation(url) {
      if (!url || isHandlingSuccess) return;

      if (url.includes('access_token=') && url.includes('id_token=')) {
        isHandlingSuccess = true;
        sendLog('info', 'Autenticação concluída! Extraindo credenciais da Riot...');

        try {
          const res = await riotApi.extractAndSetTokensFromUri(url);

          const riotSession = session.fromPartition('persist:riot');
          const cookies = await riotSession.cookies.get({ domain: 'riotgames.com' });
          riotApi.sessionCookies = cookies.map(c => `${c.name}=${c.value}`);
          saveAuth(riotApi.getSessionData());

          sendLog('success', `Conectado com sucesso como ${res.gameName}#${res.tagLine} (${res.region.toUpperCase()})`);

          if (authWebWindow && !authWebWindow.isDestroyed()) {
            authWebWindow.close();
            authWebWindow = null;
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('app:auth-success', res);
          }

          startMonitor();
        } catch (err) {
          isHandlingSuccess = false;
          sendLog('error', `Erro ao processar tokens da WebView: ${err.message}`);
        }
      } else if (url.includes('error=')) {
        try {
          const urlObj = new URL(url.replace('#', '?'));
          const errDesc = urlObj.searchParams.get('error_description') || urlObj.searchParams.get('error');
          if (errDesc) {
            sendLog('warn', `Aviso Riot: ${errDesc}`);
          }
        } catch {}
      }
    }

    authWebWindow.webContents.on('will-redirect', (e, url) => checkNavigation(url));
    authWebWindow.webContents.on('will-navigate', (e, url) => checkNavigation(url));
    authWebWindow.webContents.on('did-navigate', (e, url) => checkNavigation(url));
    authWebWindow.webContents.on('did-redirect-navigation', (e, url) => checkNavigation(url));

    const pollInterval = setInterval(() => {
      if (authWebWindow && !authWebWindow.isDestroyed()) {
        const currentUrl = authWebWindow.webContents.getURL();
        checkNavigation(currentUrl);
      } else {
        clearInterval(pollInterval);
      }
    }, 200);

    authWebWindow.on('closed', () => {
      clearInterval(pollInterval);
      authWebWindow = null;
    });

    return { opened: true };
  });

  ipcMain.handle('auth:logout', async () => {
    if (pollingInterval) clearInterval(pollingInterval);
    riotApi = new RiotAPI();
    clearAuth();
    try {
      const riotSession = session.fromPartition('persist:riot');
      await riotSession.clearStorageData();
      await riotSession.clearAuthCache();
    } catch (e) {
      console.error('Erro ao limpar cookies da partição persist:riot:', e);
    }
    sendLog('info', 'Usuário desconectado.');
    sendStatus({ state: 'disconnected', text: 'Desconectado' });
    return { success: true };
  });

  ipcMain.handle('auth:get-state', () => {
    return riotApi.getState();
  });

  ipcMain.handle('data:get-maps-and-agents', async () => {
    return await fetchGameData();
  });

  ipcMain.handle('config:get', () => config);

  ipcMain.handle('config:save', (_, newConfig) => {
    const success = saveConfig(newConfig);
    if (newConfig.region && newConfig.region !== riotApi.region) {
      riotApi.setRegion(newConfig.region);
      sendLog('info', `Região alterada para ${newConfig.region.toUpperCase()}`);
    }
    return success;
  });

  ipcMain.handle('app:open-external', (_, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      const { shell } = require('electron');
      shell.openExternal(url);
      return true;
    }
    return false;
  });

  ipcMain.handle('app:check-updates', async () => {
    return await checkForAppUpdates();
  });
}

app.whenReady().then(async () => {
  loadConfig();
  setupIpc();
  createWindow();

  // Pré-carregar dados de mapas e agentes
  await fetchGameData();

  // Tentar restaurar sessão salva ou login silencioso
  await restoreOrSilentLogin();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (pollingInterval) clearInterval(pollingInterval);
  if (process.platform !== 'darwin') app.quit();
});
