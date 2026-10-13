# VALORANT Instalock Cloud (Node.js + Electron)

Aplicativo Desktop em **Node.js** e **Electron** para seleção e assistência de agentes no VALORANT baseada no mapa sorteado (ex: **Ascent -> Breach**).

---

## ⚡ Como funciona a integração 100% em Nuvem

Diferente de scripts locais que buscam o arquivo `lockfile` na pasta do jogo, este aplicativo se conecta **diretamente aos servidores remotos da Riot Games via RSO (Riot Sign On)**:

1. **Login Oficial Riot:** O app abre diretamente a tela oficial de autenticação da Riot Games (`auth.riotgames.com`) com sessão persistente.
2. **Sincronização em Nuvem:** O app monitora a API de pré-jogo da Riot (`/pregame/v1/players/{puuid}`) em tempo real.
3. **Detecção do Mapa:** Assim que uma partida é encontrada na fila e entra na tela de seleção, o app consulta os detalhes da partida (`/pregame/v1/matches/{MatchID}`) e identifica o mapa sorteado (ex: `Ascent`, `Bind`, `Haven`, etc.).
4. **Instalock Automático:** Ao detectar o mapa, se houver um agente configurado para ele (ex: **Breach** no **Ascent**), o app envia a requisição de lock (`/pregame/v1/matches/{MatchID}/lock/{agentUuid}`) respeitando o delay configurado.

---

## 🚀 Como Executar Localmente

### Opção 1: Pelo executável rápido
Basta dar dois cliques no arquivo:
```
iniciar.bat
```

### Opção 2: Pelo terminal
```powershell
npm install
npm start
```

---

## 📦 Como Gerar o Executável (.exe)

Para compilar o aplicativo em instalador ou versão portátil para o Windows:

```powershell
# Gerar instalador (NSIS) e versão portátil (.exe único) na pasta dist/
npm run dist
```

---

## 🔄 Atualizações Automáticas (GitHub Releases)

O aplicativo conta com checagem automática integrada com o GitHub Releases:
- Toda vez que o aplicativo é iniciado, ele consulta a API do repositório (`supidooo/valorant-instalock`).
- Se houver uma nova release lançada no GitHub com versão superior, um banner de aviso aparece no topo com o botão de download direto da nova versão.

---

## 🛠️ Recursos do Aplicativo

- **Login Direto pela Janela Oficial da Riot Games:** Autenticação segura com suporte a 2FA e persistência de sessão (`auth.json` e partição isolada).
- **Interface Tática VALORANT:** Painel escuro com grid de mapas, ícones oficiais das classes e preview ao vivo.
- **Configuração Mapa x Agente:** Escolha agentes individualmente para cada mapa competitivo do jogo.
- **Delay Humano Seguro:** Opções de delay (0ms, 300ms, 700ms, 1200ms) para proteger o envio das requisições.
- **Gaveta de Histórico:** Acompanhamento dos logs e eventos em tempo real.

---

## ⚠️ Aviso Legal & Isenção de Responsabilidade

Este projeto foi desenvolvido estritamente para **fins educacionais e de estudo** sobre a arquitetura de APIs e o ecossistema Electron.

- **Não invasivo**: Este software **NÃO** altera arquivos locais do jogo, **NÃO** faz injeção de código/DLLs e **NÃO** lê a memória do processo do VALORANT. Toda a comunicação ocorre exclusivamente através de requisições HTTPS remotas oficiais via Riot Sign On (RSO).
- **Sem vínculo**: Este aplicativo não é afiliado, patrocinado ou endossado pela Riot Games.
- O uso desta ferramenta é de responsabilidade individual do usuário.

> *"VALORANT Instalock isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc."*

---

## 📄 Licença

Distribuído sob a licença [MIT](LICENSE).
