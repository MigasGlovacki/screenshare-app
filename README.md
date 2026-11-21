# ScreenShare Web

Compartilhamento de tela pelo navegador para um espectador por vez. O React/Vite fica em `client/`. O Express e o Socket.IO ficam em `server/`. O vídeo passa pelo WebRTC e a captura começa com o seletor nativo do navegador.

## Rodar no Windows

Abra o PowerShell na pasta do projeto. Use Node.js 22.12 ou superior com npm.

```powershell
npm install
npm run dev
```

Abra [http://127.0.0.1:5173](http://127.0.0.1:5173). O Vite encaminha o WebSocket ao servidor na porta 3000. Se o PowerShell bloquear `npm.ps1`, use `npm.cmd` nos mesmos comandos.

O arquivo `.env` é opcional. Para usar uma porta diferente ou configurar os servidores ICE, execute `Copy-Item .env.example .env` e edite o arquivo antes de iniciar. Por padrão, o Express escuta em `127.0.0.1`.

## Testar em duas abas

1. Abra o aplicativo no Chrome ou Edge, selecione **720p / 30 FPS** ou **1080p / 60 FPS** e clique em **Compartilhar tela**.
2. Selecione uma janela ou aba com algum conteúdo em movimento. Confira a prévia e clique em **Copiar link**.
3. Abra o link em outra aba. Aguarde **Ao vivo**, confira o movimento e teste **Tela cheia**. Se a reprodução automática for bloqueada, clique em **Reproduzir vídeo**.
4. Com o espectador conectado, tente abrir o link em uma terceira aba. Ela deve mostrar que a sala já tem um espectador.
5. Clique em **Parar transmissão** ou pare o compartilhamento pelo controle do navegador. O espectador deve receber o aviso de encerramento. Atualizar o link deve informar que a sala deixou de existir.

As opções de qualidade são metas. A resolução e os FPS reais dependem da fonte, do navegador e da conexão. O aplicativo captura só vídeo. O link permite acesso a quem o possui enquanto a sala estiver ativa. O segredo do transmissor fica na sessão de sinalização e o servidor remove a sala quando o transmissor sai.

## Assistir por HTTP na mesma rede

1. No Windows, rode `ipconfig` e encontre o IPv4 da interface conectada à rede do espectador.
2. Crie ou edite o `.env`. Substitua o IP do exemplo pelo seu.

```dotenv
LISTEN_HOST=0.0.0.0
VIEWER_ORIGIN=http://192.168.1.10:3000
```

3. Rode `npm run build` e `npm start`.
4. No computador transmissor, abra [http://127.0.0.1:3000](http://127.0.0.1:3000), inicie a captura e copie o link. O link aponta para o IPv4 da rede.
5. Abra o link em outro dispositivo na mesma rede. Se a página nem abrir, confira IP, porta e se o Firewall do Windows permite a conexão na rede privada.

A captura exige localhost ou HTTPS. O espectador pode abrir o endereço HTTP na rede local porque apenas recebe o vídeo. Use esse modo em uma rede de confiança, pois o HTTP deixa o link e a sinalização sem criptografia. [Contextos seguros no navegador](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)

## Testar pela internet com HTTPS

Para iniciar o servidor e o túnel com um comando no Windows, rode `npm run build`, salve o executável Windows de [cloudflared](https://developers.cloudflare.com/tunnel/downloads/) como `cloudflared.exe` na raiz do projeto e execute `node --env-file-if-exists=.env scripts/start-screenshare.mjs`. O iniciador abre o endereço público no navegador. Mantenha a janela aberta durante o compartilhamento.

### Iniciar manualmente

Em um terminal, com o modo de desenvolvimento encerrado, compile e inicie a versão de produção:

```powershell
npm run build
npm start
```

1. Baixe o executável Windows de [cloudflared](https://developers.cloudflare.com/tunnel/downloads/) na máquina do transmissor e salve como `cloudflared.exe`.
2. Em outro PowerShell, na pasta do executável, rode o comando abaixo. Ajuste a porta se alterou `PORT`.
3. Abra no seu navegador a URL HTTPS `trycloudflare.com` exibida no terminal. Inicie a captura por essa página e envie ao amigo o **link do espectador** gerado pelo aplicativo.
4. Peça ao amigo para abrir o link em outra rede. Confirme o vídeo e interrompa a transmissão. Pressione **Ctrl+C** no terminal do túnel quando terminar.

```powershell
.\cloudflared.exe tunnel --url http://127.0.0.1:3000
```

O Quick Tunnel é temporário e dispensa conta Cloudflare. A URL muda quando ele reinicia. O transmissor roda o executável e seu amigo só abre o link no navegador. [Documentação de Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

O túnel fornece HTTPS para a página e transporta a sinalização WebSocket. O vídeo tenta seguir diretamente entre os navegadores, com STUN para descobrir rotas. Se as redes bloquearem a conexão direta, o WebRTC pode usar um servidor TURN. [Documentação de TURN](https://webrtc.org/getting-started/turn-server)

Se a página nem abrir, confira se o link usa a URL HTTPS do túnel e se ambos os terminais estão ativos. Se a página abrir e ficar em **Conectando vídeo** até informar falha, a entrada na sala funcionou. Nesse caso, teste com TURN.

### TURN opcional

Preencha `TURN_URLS`, `TURN_USERNAME` e `TURN_CREDENTIAL` no `.env` e reinicie o Express. `STUN_URLS` e `TURN_URLS` aceitam listas separadas por vírgula. Use credenciais próprias para clientes WebRTC e com escopo restrito, pois os navegadores que entram na sala recebem esses valores para autenticar no relay.
