const axios = require('axios');

const CLIENT_PLATFORM = 'ewogICJwbGF0Zm9ybVR5cGUiOiAiUEMiLAogICJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLAogICJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwKICAicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iCn0=';
const RIOT_USER_AGENT = 'RiotClient/43.0.1.4195386.4190634 rso-auth (Windows; 10;;Enterprise; x64)';

class RiotAPI {
  constructor() {
    this.sessionCookies = [];
    this.accessToken = null;
    this.idToken = null;
    this.entitlementsToken = null;
    this.puuid = null;
    this.gameName = null;
    this.tagLine = null;
    this.clientVersion = 'release-13.06-shipping-18-5590001';
    this.region = 'br';
    this.shard = 'na'; // Riot's BR and LATAM accounts route to NA shard
    this.lastLockedMatchId = null;
    this.isPolling = false;
    this.pollTimer = null;
  }

  getCookieHeader() {
    return this.sessionCookies.map(c => c.split(';')[0]).join('; ');
  }

  saveCookies(setCookieHeader) {
    if (!setCookieHeader) return;
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    cookies.forEach(newCookie => {
      const name = newCookie.split('=')[0];
      this.sessionCookies = this.sessionCookies.filter(c => !c.startsWith(name + '='));
      this.sessionCookies.push(newCookie.split(';')[0]);
    });
  }

  // 1. Iniciar sessão de autenticação na Riot
  async initAuth() {
    this.sessionCookies = [];
    const res = await axios.post('https://auth.riotgames.com/api/v1/authorization', {
      client_id: 'play-valorant-web-prod',
      nonce: '1',
      redirect_uri: 'https://playvalorant.com/opt_in',
      response_type: 'token id_token',
      scope: 'account openid'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': RIOT_USER_AGENT
      }
    });

    this.saveCookies(res.headers['set-cookie']);
    return res.data;
  }

  // 2. Fazer login direto com usuário e senha
  async loginWithCredentials(username, password) {
    await this.initAuth();

    const res = await axios.put('https://auth.riotgames.com/api/v1/authorization', {
      type: 'auth',
      username,
      password,
      remember: true,
      language: 'en_US'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.getCookieHeader(),
        'User-Agent': RIOT_USER_AGENT
      }
    });

    this.saveCookies(res.headers['set-cookie']);
    const data = res.data;

    if (data.type === 'response') {
      const uri = data.response.parameters.uri;
      return await this.extractAndSetTokensFromUri(uri);
    } else if (data.type === 'multifactor') {
      return {
        status: '2fa_required',
        email: data.multifactor?.email || 'seu e-mail/aplicativo'
      };
    } else if (data.error === 'auth_failure') {
      throw new Error('Usuário ou senha incorretos.');
    } else if (data.error === 'rate_limited') {
      throw new Error('Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
    } else {
      throw new Error(`Erro desconhecido na autenticação: ${JSON.stringify(data)}`);
    }
  }

  // 3. Submeter código 2FA
  async submit2FACode(code) {
    const res = await axios.put('https://auth.riotgames.com/api/v1/authorization', {
      type: 'multifactor',
      code: String(code).trim(),
      rememberDevice: true
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.getCookieHeader(),
        'User-Agent': RIOT_USER_AGENT
      }
    });

    this.saveCookies(res.headers['set-cookie']);
    const data = res.data;

    if (data.type === 'response') {
      const uri = data.response.parameters.uri;
      return await this.extractAndSetTokensFromUri(uri);
    } else if (data.error === 'multifactor_attempt_failed') {
      throw new Error('Código 2FA inválido ou expirado.');
    } else {
      throw new Error(`Falha no 2FA: ${JSON.stringify(data)}`);
    }
  }

  // 4. Configurar tokens vindos de redirecionamento (Webview ou direto)
  async extractAndSetTokensFromUri(uri) {
    const hash = uri.split('#')[1] || uri.split('?')[1] || '';
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const idToken = params.get('id_token');

    if (!accessToken) {
      throw new Error('Não foi possível obter o token de acesso da Riot.');
    }

    this.accessToken = accessToken;
    this.idToken = idToken;

    // Buscar versão atualizada do Valorant
    await this.fetchClientVersion();

    // Obter Entitlements
    await this.fetchEntitlements();

    // Obter dados do usuário
    const userInfo = await this.fetchUserInfo();

    // Obter ou validar região
    await this.detectRegion();

    return {
      status: 'authenticated',
      gameName: userInfo.gameName,
      tagLine: userInfo.tagLine,
      puuid: this.puuid,
      region: this.region
    };
  }

  async fetchClientVersion() {
    try {
      const res = await axios.get('https://valorant-api.com/v1/version');
      if (res.data?.data?.riotClientVersion) {
        this.clientVersion = res.data.data.riotClientVersion;
      }
    } catch {
      // Manter padrão se a API estiver fora
    }
  }

  async fetchEntitlements() {
    const res = await axios.post('https://entitlements.auth.riotgames.com/api/token/v1', {}, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': RIOT_USER_AGENT
      }
    });
    this.entitlementsToken = res.data.entitlements_token;
    return this.entitlementsToken;
  }

  decodeJwt(token) {
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
          base64 += '=';
        }
        return JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
      }
    } catch {
      return null;
    }
    return null;
  }

  isTokenExpired(token, marginSeconds = 120) {
    if (!token) return true;
    const payload = this.decodeJwt(token);
    if (!payload || !payload.exp) return true;
    return (Date.now() / 1000) >= (payload.exp - marginSeconds);
  }

  getSessionData() {
    return {
      accessToken: this.accessToken,
      idToken: this.idToken,
      entitlementsToken: this.entitlementsToken,
      puuid: this.puuid,
      gameName: this.gameName,
      tagLine: this.tagLine,
      region: this.region,
      sessionCookies: this.sessionCookies,
      savedAt: Date.now()
    };
  }

  getState() {
    return {
      isAuthenticated: !!this.accessToken,
      gameName: this.gameName,
      tagLine: this.tagLine,
      puuid: this.puuid,
      region: this.region
    };
  }

  async restoreSession(data) {
    if (!data || !data.accessToken) return false;

    // Se o token ainda não expirou
    if (!this.isTokenExpired(data.accessToken)) {
      this.accessToken = data.accessToken;
      this.idToken = data.idToken || null;
      this.entitlementsToken = data.entitlementsToken || null;
      this.puuid = data.puuid || null;
      this.gameName = data.gameName || 'Jogador';
      this.tagLine = data.tagLine || 'BR1';
      this.region = data.region || 'br';
      this.sessionCookies = Array.isArray(data.sessionCookies) ? data.sessionCookies : [];
      this.setRegion(this.region);

      try {
        if (!this.entitlementsToken) {
          await this.fetchEntitlements();
        }
        await this.fetchClientVersion();
        const userInfo = await this.fetchUserInfo();
        return {
          status: 'authenticated',
          gameName: userInfo.gameName,
          tagLine: userInfo.tagLine,
          puuid: this.puuid,
          region: this.region
        };
      } catch (err) {
        console.warn('Falha ao validar sessão restaurada:', err.message);
        this.accessToken = null;
        return false;
      }
    }

    return false;
  }

  parseIdToken() {
    return this.decodeJwt(this.idToken);
  }

  async fetchUserInfo() {
    try {
      const res = await axios.get('https://auth.riotgames.com/userinfo', {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'User-Agent': RIOT_USER_AGENT
        },
        timeout: 4000
      });

      this.puuid = res.data.sub;
      this.gameName = res.data.acct?.game_name || res.data.username;
      this.tagLine = res.data.acct?.tag_line;
    } catch (err) {
      console.warn('Rota userinfo não respondeu, usando fallback do token:', err.message);
    }

    // Fallback: extrair diretamente do JWT id_token
    if (!this.gameName || !this.puuid) {
      const idPayload = this.parseIdToken();
      if (idPayload) {
        this.puuid = this.puuid || idPayload.sub;
        this.gameName = this.gameName || idPayload.acct?.game_name || 'Jogador';
        this.tagLine = this.tagLine || idPayload.acct?.tag_line || 'BR1';
      }
    }

    this.gameName = this.gameName || 'Jogador';
    this.tagLine = this.tagLine || 'BR1';

    return {
      puuid: this.puuid,
      gameName: this.gameName,
      tagLine: this.tagLine
    };
  }

  async detectRegion() {
    if (!this.idToken) return;
    try {
      const res = await axios.put('https://riot-geo.pas.riotgames.com/pas/v1/product/valorant', {
        id_token: this.idToken
      }, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      const liveAffinity = res.data?.affinities?.live;
      if (liveAffinity) {
        this.setRegion(liveAffinity);
      }
    } catch {
      // Default to BR
      this.setRegion('br');
    }
  }

  setRegion(regionName) {
    const r = regionName.toLowerCase();
    this.region = r;
    if (r === 'br' || r === 'latam' || r === 'na') {
      this.shard = 'na';
    } else if (r === 'eu') {
      this.shard = 'eu';
    } else if (r === 'ap') {
      this.shard = 'ap';
    } else if (r === 'kr') {
      this.shard = 'kr';
    } else {
      this.shard = 'na';
    }
  }

  getGlzUrl() {
    // Endpoint GLZ para pre-game
    return `https://glz-${this.region}-1.${this.shard}.a.pvp.net`;
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'X-Riot-Entitlements-JWT': this.entitlementsToken,
      'X-Riot-ClientVersion': this.clientVersion,
      'X-Riot-ClientPlatform': CLIENT_PLATFORM,
      'User-Agent': RIOT_USER_AGENT
    };
  }

  // 5. Verificar status do jogador no pré-jogo
  async checkPreGamePlayer() {
    if (!this.accessToken || !this.puuid) return null;

    const url = `${this.getGlzUrl()}/pregame/v1/players/${this.puuid}`;
    try {
      const res = await axios.get(url, { headers: this.getHeaders(), timeout: 3000 });
      return res.data; // { MatchID: "..." }
    } catch (err) {
      if (err.response && err.response.status === 404) {
        // Jogador não está em partida de pré-jogo
        return null;
      }
      throw err;
    }
  }

  // 6. Obter detalhes da partida de pré-jogo (Mapa, Jogadores)
  async getPreGameMatch(matchId) {
    const url = `${this.getGlzUrl()}/pregame/v1/matches/${matchId}`;
    const res = await axios.get(url, { headers: this.getHeaders(), timeout: 4000 });
    return res.data;
  }

  // 7. Selecionar Agente (Select / Hover)
  async selectAgent(matchId, agentId) {
    const url = `${this.getGlzUrl()}/pregame/v1/matches/${matchId}/select/${agentId}`;
    const res = await axios.post(url, {}, { headers: this.getHeaders() });
    return res.data;
  }

  // 8. Trancar Agente (Lock / Instalock)
  async lockAgent(matchId, agentId) {
    const url = `${this.getGlzUrl()}/pregame/v1/matches/${matchId}/lock/${agentId}`;
    const res = await axios.post(url, {}, { headers: this.getHeaders() });
    return res.data;
  }

  // 9. Obter maestria/progresso dos contratos dos agentes
  async fetchPlayerContracts() {
    if (!this.accessToken || !this.puuid) return {};
    try {
      const url = `https://pd.${this.shard}.a.pvp.net/contracts/v1/contracts/${this.puuid}`;
      const res = await axios.get(url, { headers: this.getHeaders(), timeout: 4000 });
      const contracts = res.data?.Contracts || [];
      const masteryMap = {};
      contracts.forEach(c => {
        const level = c.ProgressionLevelReached || c.ContractProgression?.HighestUnlockedLevel || 1;
        masteryMap[c.ContractDefinitionID] = level;
      });
      return masteryMap;
    } catch {
      return {};
    }
  }
}

module.exports = RiotAPI;
