// State
let currentConfig = {
  autoLockEnabled: true,
  lockDelayMs: 1200,
  region: 'br',
  mapAgents: {}
};

let gameData = {
  agents: [],
  maps: []
};

let activeMap = null;
let activeRoleFilter = 'all';
let previewAgent = null;
let toastTimeout = null;

// DOM Elements: Main Maps Grid
const mapsGrid = document.getElementById('mapsGrid');
const statsLockedCount = document.getElementById('statsLockedCount');

// Modal Elements: Agent Selection
const agentSelectModal = document.getElementById('agentSelectModal');
const btnCloseAgentModal = document.getElementById('btnCloseAgentModal');
const modalMapTitle = document.getElementById('modalMapTitle');
const roleButtons = document.querySelectorAll('.role-btn');
const agentGrid = document.getElementById('agentGrid');
const btnDeselectAgent = document.getElementById('btnDeselectAgent');

// Showcase Elements inside Modal
const showcaseBg = document.getElementById('showcaseBg');
const agentShowcaseName = document.getElementById('agentShowcaseName');
const agentRolePill = document.getElementById('agentRolePill');
const agentRoleIcon = document.getElementById('agentRoleIcon');
const agentRoleText = document.getElementById('agentRoleText');
const agentBio = document.getElementById('agentBio');
const agentFullPortrait = document.getElementById('agentFullPortrait');
const btnConfirmLock = document.getElementById('btnConfirmLock');
const btnConfirmText = document.getElementById('btnConfirmText');
const lockStatusIndicator = document.getElementById('lockStatusIndicator');
const lockStatusText = document.getElementById('lockStatusText');

// Player Card
const playerAgentIcon = document.getElementById('playerAgentIcon');
const playerCardName = document.getElementById('playerCardName');
const playerCardStatus = document.getElementById('playerCardStatus');

// Top Controls
const toggleAutoLock = document.getElementById('toggleAutoLock');
const selectDelay = document.getElementById('selectDelay');
const btnOpenLogin = document.getElementById('btnOpenLogin');
const userProfile = document.getElementById('userProfile');
const userInitial = document.getElementById('userInitial');
const userName = document.getElementById('userName');
const btnLogout = document.getElementById('btnLogout');

// Drawer & Toast
const btnToggleDrawer = document.getElementById('btnToggleDrawer');
const historyDrawer = document.getElementById('historyDrawer');
const btnCloseDrawer = document.getElementById('btnCloseDrawer');
const drawerLogs = document.getElementById('drawerLogs');
const btnClearDrawerLogs = document.getElementById('btnClearDrawerLogs');
const toastNotification = document.getElementById('toastNotification');
const toastMessage = document.getElementById('toastMessage');

// Toast Helper
function showToast(msg) {
  if (toastTimeout) clearTimeout(toastTimeout);
  toastMessage.innerText = msg;
  toastNotification.classList.remove('hidden');
  toastTimeout = setTimeout(() => {
    toastNotification.classList.add('hidden');
  }, 3500);
}

// Drawer Log Item
function addDrawerLog(type, message, timestamp) {
  const time = timestamp || new Date().toLocaleTimeString('pt-BR');
  const item = document.createElement('div');
  item.className = `drawer-log-item ${type}`;
  item.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-desc">${escapeHtml(message)}</span>
  `;
  drawerLogs.appendChild(item);
  drawerLogs.scrollTop = drawerLogs.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

// Atualizar User Profile
function updateUserUI(user) {
  if (user && user.gameName) {
    btnOpenLogin.classList.add('hidden');
    userProfile.classList.remove('hidden');
    userName.innerText = `${user.gameName}#${user.tagLine || 'BR1'}`;
    userInitial.innerText = user.gameName.charAt(0).toUpperCase();
    playerCardName.innerText = user.gameName;
    playerCardStatus.innerText = '🟢 Sincronizado na Nuvem';
  } else {
    btnOpenLogin.classList.remove('hidden');
    userProfile.classList.add('hidden');
    playerCardName.innerText = 'Jogador';
    playerCardStatus.innerText = 'Não autenticado';
  }
}

// =========================================================
// RENDERIZAR O GRID DE MAPAS (A DISPOSIÇÃO BACANA DE ANTES)
// =========================================================
function renderMapsGrid() {
  if (!gameData.maps || !gameData.maps.length) {
    mapsGrid.innerHTML = '<div class="loading-state">Nenhum mapa disponível.</div>';
    return;
  }

  mapsGrid.innerHTML = '';
  let lockedCount = 0;

  gameData.maps.forEach(map => {
    const card = document.createElement('div');
    card.className = 'map-card';

    const configuredAgentUuid = currentConfig.mapAgents[map.mapUrl];
    const configuredAgent = configuredAgentUuid ? gameData.agents.find(a => a.uuid === configuredAgentUuid) : null;

    if (configuredAgent) {
      card.classList.add('has-lock');
      lockedCount++;
    }

    const splashImg = map.splash || map.listViewIcon || '';

    let slotHtml = '';
    if (configuredAgent) {
      slotHtml = `
        <div class="map-agent-slot">
          <div class="agent-thumb-box">
            <img src="${configuredAgent.displayIcon}" alt="${configuredAgent.displayName}">
          </div>
          <div class="agent-name-role">
            <span class="agent-slot-name">${configuredAgent.displayName.toUpperCase()}</span>
            <span class="agent-slot-role">${configuredAgent.role?.displayName || 'Agente'}</span>
          </div>
          <span class="btn-change-agent">ALTERAR</span>
        </div>
      `;
    } else {
      slotHtml = `
        <div class="map-empty-slot">
          <span>+ ESCOLHER AGENTE</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="map-card-bg" style="background-image: url('${splashImg}');"></div>
      <div class="map-card-overlay"></div>
      <div class="map-card-content">
        <div class="map-card-header">
          <span class="map-card-title">${map.displayName.toUpperCase()}</span>
          <span class="map-status-pill ${configuredAgent ? 'active' : 'manual'}">
            ${configuredAgent ? '⚡ AUTO-LOCK' : 'MANUAL'}
          </span>
        </div>
        ${slotHtml}
      </div>
    `;

    // Ao clicar em qualquer mapa, abre a tela de seleção de agentes!
    card.addEventListener('click', () => {
      openAgentModal(map);
    });

    mapsGrid.appendChild(card);
  });

  // Atualizar contador do topo
  statsLockedCount.innerText = `${lockedCount} ${lockedCount === 1 ? 'mapa configurado' : 'mapas configurados'}`;
}

// =========================================================
// MODAL: SELEÇÃO DE AGENTES DO VALORANT
// =========================================================
function openAgentModal(map) {
  activeMap = map;
  modalMapTitle.innerText = map.displayName.toUpperCase();

  const mapBgImg = map.splash || map.listViewIcon || '';
  showcaseBg.style.backgroundImage = `url('${mapBgImg}')`;

  // Pegar agente atual ou default
  const configuredAgentUuid = currentConfig.mapAgents[map.mapUrl];
  let initialAgent = null;

  if (configuredAgentUuid) {
    initialAgent = gameData.agents.find(a => a.uuid === configuredAgentUuid);
  }

  if (!initialAgent) {
    initialAgent = gameData.agents.find(a => a.displayName.toLowerCase() === 'breach') || gameData.agents[0];
  }

  setPreviewAgent(initialAgent);
  renderAgentGrid();

  agentSelectModal.classList.remove('hidden');
}

function closeAgentModal() {
  agentSelectModal.classList.add('hidden');
  renderMapsGrid();
}

btnCloseAgentModal.addEventListener('click', closeAgentModal);

// Definir Agente em Destaque na Direita
function setPreviewAgent(agent) {
  if (!agent) return;
  previewAgent = agent;

  agentShowcaseName.innerText = agent.displayName.toUpperCase();
  agentBio.innerText = agent.role?.description || agent.description || '';
  agentRoleText.innerText = (agent.role?.displayName || 'AGENTE').toUpperCase();

  if (agent.role?.displayIcon) {
    agentRoleIcon.src = agent.role.displayIcon;
    agentRoleIcon.classList.remove('hidden');
  } else {
    agentRoleIcon.classList.add('hidden');
  }

  agentFullPortrait.src = agent.fullPortrait || agent.displayIcon;
  playerAgentIcon.src = agent.displayIcon;

  // Checar se o agente em preview é o trancado neste mapa
  const isLockedForThisMap = currentConfig.mapAgents[activeMap?.mapUrl] === agent.uuid;

  if (isLockedForThisMap) {
    btnConfirmLock.className = 'btn-valorant-confirm active-confirmed';
    btnConfirmText.innerText = 'AGENTE TRANCADO';
    lockStatusIndicator.style.color = 'var(--v-cyan)';
    lockStatusText.innerText = `INSTALOCK ATIVO NO MAPA ${activeMap?.displayName.toUpperCase()}`;
  } else {
    btnConfirmLock.className = 'btn-valorant-confirm';
    btnConfirmText.innerText = `CONFIRMAR ${agent.displayName.toUpperCase()}`;
    lockStatusIndicator.style.color = 'var(--text-muted)';
    lockStatusText.innerText = `CLIQUE NO BOTÃO PARA TRANCAR`;
  }
}

// Renderizar Grade de Agentes no Modal (4 Colunas)
function renderAgentGrid() {
  agentGrid.innerHTML = '';

  const filteredAgents = gameData.agents.filter(agent => {
    if (activeRoleFilter === 'all') return true;
    return agent.role?.displayName?.toLowerCase() === activeRoleFilter.toLowerCase();
  });

  const configuredAgentUuid = currentConfig.mapAgents[activeMap?.mapUrl];

  filteredAgents.forEach(agent => {
    const tile = document.createElement('div');
    tile.className = 'agent-tile';

    const isLocked = agent.uuid === configuredAgentUuid;
    const isPreviewing = previewAgent && agent.uuid === previewAgent.uuid;

    if (isLocked) {
      tile.classList.add('locked');
    }
    if (isPreviewing) {
      tile.classList.add('previewing');
    }

    tile.innerHTML = `
      <img class="agent-tile-img" src="${agent.displayIcon}" alt="${agent.displayName}">
    `;

    // Clicar no agente apenas visualiza/seleciona na vitrine (sem trancar ainda)
    tile.addEventListener('click', () => {
      setPreviewAgent(agent);
      renderAgentGrid();
    });

    agentGrid.appendChild(tile);
  });
}

// Trancar Agente para o Mapa (Acionado apenas pelo botão CONFIRMAR)
function lockAgentForCurrentMap(agent) {
  if (!activeMap) return;

  currentConfig.mapAgents[activeMap.mapUrl] = agent.uuid;
  window.api.saveConfig(currentConfig);

  setPreviewAgent(agent);
  renderAgentGrid();

  showToast(`⚡ ${agent.displayName} trancado para o mapa ${activeMap.displayName}!`);
  addDrawerLog('success', `${agent.displayName} trancado para instalock no mapa ${activeMap.displayName}.`);
}

// Desmarcar Agente do Mapa
btnDeselectAgent.addEventListener('click', () => {
  if (!activeMap) return;

  delete currentConfig.mapAgents[activeMap.mapUrl];
  window.api.saveConfig(currentConfig);

  renderAgentGrid();
  setPreviewAgent(previewAgent);

  showToast(`Instalock desativado para ${activeMap.displayName}`);
  addDrawerLog('info', `Instalock desativado no mapa ${activeMap.displayName}.`);
});

// Botão Vermelho de Confirmação (Tranca de fato o agente)
btnConfirmLock.addEventListener('click', () => {
  if (previewAgent && activeMap) {
    lockAgentForCurrentMap(previewAgent);
  }
});

// Filtros de Categoria (Role)
roleButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    roleButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeRoleFilter = btn.getAttribute('data-role');
    renderAgentGrid();
  });
});

// Controles Topo
toggleAutoLock.addEventListener('change', () => {
  currentConfig.autoLockEnabled = toggleAutoLock.checked;
  window.api.saveConfig(currentConfig);
  const stateStr = currentConfig.autoLockEnabled ? 'ATIVADO' : 'DESATIVADO';
  showToast(`Auto-Lock ${stateStr}`);
  addDrawerLog('info', `Auto-Lock ${stateStr}.`);
});

selectDelay.addEventListener('change', () => {
  currentConfig.lockDelayMs = parseInt(selectDelay.value, 10);
  window.api.saveConfig(currentConfig);
  showToast(`Delay: ${selectDelay.options[selectDelay.selectedIndex].text}`);
  addDrawerLog('info', `Delay configurado para: ${currentConfig.lockDelayMs} ms`);
});

// Drawer de Histórico
btnToggleDrawer.addEventListener('click', () => {
  historyDrawer.classList.toggle('hidden');
});

btnCloseDrawer.addEventListener('click', () => {
  historyDrawer.classList.add('hidden');
});

btnClearDrawerLogs.addEventListener('click', () => {
  drawerLogs.innerHTML = '';
});

// Login Oficial Riot Games (Abre direto a janela oficial)
btnOpenLogin.addEventListener('click', () => {
  window.api.openWebviewLogin();
  addDrawerLog('info', 'Abrindo janela de login oficial da Riot Games...');
});

btnLogout.addEventListener('click', async () => {
  await window.api.logout();
  updateUserUI(null);
  showToast('Desconectado com sucesso.');
  addDrawerLog('info', 'Conta desconectada.');
  renderMapsGrid();
});

// Notificação de Atualização (GitHub Releases)
const updateBanner = document.getElementById('updateBanner');
const updateBannerTitle = document.getElementById('updateBannerTitle');
const updateBannerSubtitle = document.getElementById('updateBannerSubtitle');
const btnDownloadUpdate = document.getElementById('btnDownloadUpdate');
const btnDownloadText = document.getElementById('btnDownloadText');
const btnDismissUpdate = document.getElementById('btnDismissUpdate');
let latestUpdateUrl = 'https://github.com/supidooo/valorant-instalock/releases';

function showUpdateNotification(update) {
  if (!update || !updateBanner) return;
  latestUpdateUrl = update.releaseUrl || latestUpdateUrl;
  if (update.assets && update.assets[0]?.downloadUrl) {
    latestUpdateUrl = update.assets[0].downloadUrl;
  }
  updateBannerTitle.innerText = `NOVA VERSÃO DISPONÍVEL (V${update.version})!`;
  updateBannerSubtitle.innerText = update.releaseName && update.releaseName !== `v${update.version}`
    ? `${update.releaseName} - Clique para baixar o instalador atualizado.`
    : 'Uma nova versão do Instalock foi lançada no GitHub. Clique para baixar!';
  btnDownloadText.innerText = `BAIXAR V${update.version}`;
  updateBanner.classList.remove('hidden');
}

btnDownloadUpdate.addEventListener('click', () => {
  window.api.openExternal(latestUpdateUrl);
});

btnDismissUpdate.addEventListener('click', () => {
  updateBanner.classList.add('hidden');
});

// Inicialização Principal
async function init() {
  currentConfig = await window.api.getConfig();
  toggleAutoLock.checked = currentConfig.autoLockEnabled ?? true;
  selectDelay.value = String(currentConfig.lockDelayMs ?? 1200);

  // Carregar dados oficiais do jogo
  gameData = await window.api.getGameData();

  // Garantir que o Ascent venha com Breach por padrão
  const ascentMap = gameData.maps.find(m => m.displayName.toLowerCase() === 'ascent');
  const breachAgent = gameData.agents.find(a => a.displayName.toLowerCase() === 'breach');
  if (ascentMap && breachAgent && !currentConfig.mapAgents[ascentMap.mapUrl]) {
    currentConfig.mapAgents[ascentMap.mapUrl] = breachAgent.uuid;
    window.api.saveConfig(currentConfig);
  }

  // Renderizar o Grid de Mapas no ecrã principal
  renderMapsGrid();

  // Checar se já há usuário logado
  const userState = await window.api.getUserState();
  if (userState.isAuthenticated) {
    updateUserUI(userState);
  }

  // Event Listeners IPC
  window.api.onLog((log) => {
    addDrawerLog(log.type, log.message, log.timestamp);
    if (log.type === 'success' || log.type === 'action') {
      showToast(log.message);
    }
  });

  window.api.onStatusUpdate((status) => {
    playerCardStatus.innerText = status.text;
  });

  window.api.onAuthSuccess(async (user) => {
    updateUserUI(user);
    showToast(`🟢 Conectado como ${user.gameName}!`);
    // Recarregar maestria real do jogador
    gameData = await window.api.getGameData();
    renderMapsGrid();
  });

  window.api.onUpdateAvailable((update) => {
    showUpdateNotification(update);
    addDrawerLog('info', `Nova atualização disponível: v${update.version}`);
  });
}

document.addEventListener('DOMContentLoaded', init);
