import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const port = process.env.PORT || '3000'
const localUrl = `http://127.0.0.1:${port}`
const runtime = join(process.env.LOCALAPPDATA, 'ScreenShare')
const urlFile = join(runtime, `tunnel-${port}.txt`)
const tunnelHost = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/
const children = []

function launch(file, args, stdio) {
  const child = spawn(file, args, { cwd: root, stdio, windowsHide: true })
  children.push(child)
  child.on('error', (error) => console.error(error.message))
  return child
}

function browser(url) {
  const explorer = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' })
  explorer.on('error', () => console.log(`Abra este endereço no navegador: ${url}`))
  explorer.unref()
}

async function isScreenShare(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_500), redirect: 'error' })
    return response.ok && (await response.text()).includes('<title>ScreenShare</title>')
  } catch {
    return false
  }
}

async function waitForApp(getUrl, attempts = 25) {
  for (let index = 0; index < attempts; index++) {
    const url = getUrl()
    if (url && await isScreenShare(url)) return url
    await delay(800)
  }
  throw new Error('O ScreenShare não respondeu a tempo. Confira as mensagens acima.')
}

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function stopChildren() {
  for (const child of children) child.kill()
}

process.on('SIGINT', () => {
  stopChildren()
  process.exit(0)
})
process.on('SIGHUP', stopChildren)

try {
  mkdirSync(runtime, { recursive: true })
  if (existsSync(urlFile)) {
    const [previous, owner] = readFileSync(urlFile, 'utf8').trim().split(/\r?\n/)
    if (previous.match(tunnelHost)?.[0] === previous
        && (isRunning(Number(owner)) || await isScreenShare(previous))) {
      browser(previous)
      process.exit(0)
    }
  }

  const serverEntry = join(root, 'server/dist/index.js')
  const cloudflared = join(root, 'cloudflared.exe')
  if (!existsSync(serverEntry) || !existsSync(join(root, 'client/dist/index.html'))) {
    throw new Error('A build não foi encontrada. Execute npm run build na pasta do projeto.')
  }
  if (!existsSync(cloudflared)) {
    throw new Error('O arquivo cloudflared.exe precisa estar na pasta do projeto.')
  }

  if (!await isScreenShare(localUrl)) {
    console.log('Iniciando o ScreenShare…')
    launch(process.execPath, ['--env-file-if-exists=.env', serverEntry], 'inherit')
    await waitForApp(() => localUrl, 12)
  }

  console.log('Abrindo o túnel HTTPS…')
  const tunnel = launch(cloudflared, ['tunnel', '--no-autoupdate', '--url', localUrl], ['ignore', 'pipe', 'pipe'])
  let address
  let registered = false
  let output = ''
  function readTunnelOutput(buffer) {
    output += buffer.toString()
    address ??= output.match(/\|\s+(https:\/\/[a-z0-9-]+\.trycloudflare\.com)\s+\|/)?.[1]
    registered ||= output.includes('Registered tunnel connection')
    output = output.slice(-8192)
  }
  tunnel.stdout.on('data', readTunnelOutput)
  tunnel.stderr.on('data', readTunnelOutput)
  for (let i = 0; i < 40 && (!address || !registered) && tunnel.exitCode === null; i++) {
    await delay(800)
  }
  if (!address || !registered) {
    console.error(output.slice(-1000))
    throw new Error('O Cloudflare não conseguiu abrir o túnel.')
  }
  writeFileSync(urlFile, `${address}\n${process.pid}\n`)
  console.log(`ScreenShare aberto em ${address}\nMantenha esta janela aberta. Pressione Ctrl+C para desligar.`)
  console.log('Se o navegador demorar para encontrar o endereço novo, aguarde e atualize a página.')
  browser(address)
  await new Promise((resolve, reject) => {
    if (tunnel.exitCode !== null) reject(new Error('O túnel foi encerrado.'))
    else tunnel.once('exit', () => reject(new Error('O túnel foi encerrado.')))
  })
} catch (error) {
  stopChildren()
  console.error(error.message)
  process.exitCode = 1
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      await rl.question('Pressione Enter para fechar.')
    } finally {
      rl.close()
    }
  }
}
