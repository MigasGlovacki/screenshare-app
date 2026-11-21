# ScreenShare

Compartilhamento de tela pelo navegador. O anfitrião abre a sala e copia um único convite para todos os amigos. Cada participante pode compartilhar uma tela, janela ou aba. Quando houver mais de uma transmissão, escolha qual assistir em **Telas ao vivo**. O convite continua válido entre compartilhamentos enquanto o anfitrião mantiver a sala aberta. O áudio depende da fonte e do navegador.

O LiveKit recebe o vídeo dos participantes por WebRTC e distribui as transmissões da sala. A Vercel serve a interface React/Vite e a função `/api/room`, que emite tokens de curta duração com permissão para transmitir tela e áudio da tela. O anfitrião tem a permissão de encerrar a sala. A capacidade da transmissão depende do plano do LiveKit e das conexões dos participantes. [Como funciona uma sala do LiveKit](https://docs.livekit.io/intro/basics/connect/)

## Publicar na Vercel

1. Crie um projeto no [LiveKit Cloud](https://cloud.livekit.io/). Nas configurações do projeto, copie a URL WebSocket (`wss://…`) e gere uma chave de API com seu segredo.
2. Na Vercel, importe o repositório e mantenha a raiz do projeto na raiz do repositório. O `vercel.json` configura o preset Vite, o comando `npm run build`, a saída `client/dist` e o acesso direto aos convites em `/s/<id>`.
3. Em **Settings → Environment Variables**, adicione `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` ao ambiente **Production**. Guarde os valores no servidor e mantenha os nomes sem o prefixo `VITE_`.
4. Publique ou faça um novo deploy de produção após salvar as variáveis. Para enviar este checkout pelo terminal, execute `npx vercel login`, `npx vercel link` e `npx vercel --prod`.
5. Abra o domínio público de produção, inicie uma transmissão e teste o convite em uma janela anônima. Em **Settings → Deployment Protection**, confira se o domínio está disponível para seus amigos.

[Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite) · [Variáveis de ambiente](https://vercel.com/docs/environment-variables) · [Proteção de deploy](https://vercel.com/docs/deployment-protection)

## Rodar no Windows

Use Node.js 22.22 ou superior. No PowerShell, copie o modelo, preencha as três variáveis do LiveKit no `.env` e inicie o app.

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev
```

Abra [http://127.0.0.1:5173](http://127.0.0.1:5173). O Vite encaminha a API ao Express na porta `3000`. Para testar a build de produção localmente, execute `npm.cmd run build`, depois `npm.cmd start` e abra [http://127.0.0.1:3000](http://127.0.0.1:3000).

Para testar só na sua máquina sem uma conta de nuvem, baixe o LiveKit Server para Windows, execute `livekit-server.exe --dev` e use `LIVEKIT_URL=ws://127.0.0.1:7880`, `LIVEKIT_API_KEY=devkey` e `LIVEKIT_API_SECRET=secret` no `.env` local. [Executar LiveKit localmente](https://docs.livekit.io/transport/self-hosting/local/)

## Verificar a transmissão

1. No Chrome ou Edge desktop, selecione a qualidade, clique em **Compartilhar tela** e escolha uma fonte com conteúdo em movimento. Confira a prévia.
2. Clique em **Copiar convite** e abra o mesmo link em duas abas ou dispositivos. Confira o movimento e os dois espectadores na lista de participantes do anfitrião. Teste **Tela cheia** em um espectador.
3. Deixe **Incluir áudio da tela** marcado, escolha uma aba com som e habilite o áudio no seletor do navegador. Se o navegador do espectador pedir interação, clique em **Ativar áudio** no player.
4. Clique em **Parar**. Confira se os espectadores continuam na sala. Abra o mesmo convite em outra aba enquanto a sala está sem vídeo e volte a compartilhar. Todos devem receber o vídeo sem recarregar. Repita usando o controle nativo do navegador para parar a captura.
5. Com o anfitrião transmitindo, clique em **Compartilhar** em uma aba de convidado. Confira as duas opções em **Telas ao vivo** e alterne entre elas em uma terceira aba. Pare a tela do convidado e confirme que a tela do anfitrião continua disponível.
6. No anfitrião, clique em **Encerrar sala**. Os convidados devem ver o encerramento, e o convite deve expirar.
7. Em produção, repita com um convidado usando outra rede. A captura exige HTTPS ou localhost e um navegador compatível. [Captura de tela no navegador](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

## Usar o servidor local com outras pessoas

Para convidar alguém pela internet usando a build local, configure o LiveKit Cloud no `.env`, execute `npm.cmd run build`, salve o executável [Cloudflare Tunnel para Windows](https://developers.cloudflare.com/tunnel/downloads/) como `cloudflared.exe` na raiz e execute:

```powershell
node --env-file-if-exists=.env scripts/start-screenshare.mjs
```

Inicie a captura na URL HTTPS que o script abre. O túnel transporta a interface e a API. O vídeo passa pelo LiveKit, que deve estar acessível aos navegadores. Mantenha o terminal aberto enquanto usar o túnel.

Para assistir pela rede local, use `LISTEN_HOST=0.0.0.0` e `VIEWER_ORIGIN=http://<IP-local>:3000` no `.env`. Inicie a build com `npm.cmd start` e abra o app no anfitrião via `http://127.0.0.1:3000`. Se estiver rodando o LiveKit no próprio PC, configure-o para escutar e anunciar o IP local, e use esse IP em `LIVEKIT_URL`. O endereço `127.0.0.1` aponta para o próprio dispositivo que abre o link. Use uma rede de confiança ao servir a página por HTTP. [Portas do LiveKit](https://docs.livekit.io/transport/self-hosting/ports-firewall/)
