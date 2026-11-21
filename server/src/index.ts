import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import express from 'express'
import { Server, type Socket } from 'socket.io'

interface Room {
  id: string
  secret: string
  host: Socket
  pair?: { id: string; viewer: Socket }
}

const token = () => randomBytes(24).toString('base64url')
const tokenPattern = /^[A-Za-z0-9_-]{32}$/
const rooms = new Map<string, Room>()
const listenHost = process.env.LISTEN_HOST || '127.0.0.1'
const viewerOrigin = process.env.VIEWER_ORIGIN ? new URL(process.env.VIEWER_ORIGIN) : undefined
if (viewerOrigin && (!['http:', 'https:'].includes(viewerOrigin.protocol)
    || viewerOrigin.username || viewerOrigin.password || viewerOrigin.pathname !== '/'
    || viewerOrigin.search || viewerOrigin.hash)) {
  throw new Error('VIEWER_ORIGIN deve conter apenas a origem, por exemplo http://192.168.1.10:3000.')
}
const app = express()
const http = createServer(app)
const io = new Server(http, {
  transports: ['websocket'],
  maxHttpBufferSize: 128 * 1024,
  allowRequest(req, callback) {
    const origin = req.headers.origin
    if (!origin) return callback(null, true)
    try {
      const url = new URL(origin)
      callback(null, ['http:', 'https:'].includes(url.protocol) && url.host === req.headers.host)
    } catch {
      callback(null, false)
    }
  },
})

const urls = (value = '') => value.split(',').map((url) => url.trim()).filter(Boolean)
const stun = urls(process.env.STUN_URLS || 'stun:stun.l.google.com:19302')
const turn = urls(process.env.TURN_URLS)
const username = process.env.TURN_USERNAME
const credential = process.env.TURN_CREDENTIAL
if ([turn.length > 0, Boolean(username), Boolean(credential)].some(Boolean)
    && !(turn.length && username && credential)) {
  throw new Error('Preencha TURN_URLS, TURN_USERNAME e TURN_CREDENTIAL juntos.')
}
const iceServers = [{ urls: stun }, ...(turn.length ? [{ urls: turn, username, credential }] : [])]

app.disable('x-powered-by')
app.use((_req, res, next) => {
  res.set('Referrer-Policy', 'no-referrer')
  next()
})
const dist = join(import.meta.dirname, '../../client/dist')
app.use(express.static(dist))
app.get(['/', '/s/:roomId'], (_req, res) => {
  if (existsSync(join(dist, 'index.html'))) return res.sendFile(join(dist, 'index.html'))
  res.status(503).send('Frontend indisponível. Use npm run dev ou execute npm run build.')
})

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function hostAuthorized(room: Room, socket: Socket, secret: unknown) {
  return room.host === socket && typeof secret === 'string' && tokenPattern.test(secret)
    && timingSafeEqual(Buffer.from(secret), Buffer.from(room.secret))
}

function closeRoom(room: Room) {
  rooms.delete(room.id)
  delete room.host.data.room
  if (room.pair) {
    delete room.pair.viewer.data.room
    room.pair.viewer.emit('room:ended')
  }
}

function filterSignal(value: unknown, host: boolean) {
  if (!object(value)) return
  if (value.type === (host ? 'offer' : 'answer')
      && typeof value.sdp === 'string' && value.sdp.length > 0 && value.sdp.length <= 64_000) {
    return { type: value.type, sdp: value.sdp }
  }
  if (value.type !== 'ice' || !object(value.candidate)) return
  const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = value.candidate
  if (typeof candidate !== 'string' || candidate.length > 4096) return
  if (sdpMid != null && (typeof sdpMid !== 'string' || sdpMid.length > 64)) return
  if (sdpMLineIndex != null && (typeof sdpMLineIndex !== 'number'
      || !Number.isInteger(sdpMLineIndex) || sdpMLineIndex < 0 || sdpMLineIndex > 65535)) return
  if (usernameFragment != null && (typeof usernameFragment !== 'string' || usernameFragment.length > 256)) return
  return { type: 'ice', candidate: { candidate, sdpMid, sdpMLineIndex, usernameFragment } }
}

io.on('connection', (socket) => {
  socket.on('room:create', (reply: unknown) => {
    if (typeof reply !== 'function') return
    if (socket.data.room) return reply({ error: 'Esta conexão já está em uma sala.' })
    let id = token()
    while (rooms.has(id)) id = token()
    const room: Room = { id, secret: token(), host: socket }
    rooms.set(id, room)
    socket.data.room = room
    reply({ id, secret: room.secret, iceServers, viewerOrigin: viewerOrigin?.origin })
  })

  socket.on('room:join', (id: unknown, reply: unknown) => {
    if (typeof reply !== 'function') return
    if (socket.data.room) return reply({ error: 'Esta conexão já está em uma sala.' })
    const room = typeof id === 'string' && tokenPattern.test(id) ? rooms.get(id) : undefined
    if (!room) return reply({ error: 'Esta sala não existe ou já foi encerrada.' })
    if (room.pair) return reply({ error: 'A sala já tem um espectador.' })
    const pair = { id: token(), viewer: socket }
    room.pair = pair
    socket.data.room = room
    reply({ id: room.id, iceServers })
    socket.emit('pair:start', pair.id)
    room.host.emit('pair:start', pair.id)
  })

  socket.on('room:stop', (secret: unknown) => {
    const room: Room | undefined = socket.data.room
    if (room && hostAuthorized(room, socket, secret)) closeRoom(room)
  })

  socket.on('peer:signal', (message: unknown) => {
    const room: Room | undefined = socket.data.room
    if (!room?.pair || !object(message) || room.pair.id !== message.pairId) return
    const host = room.host === socket
    if (host ? !hostAuthorized(room, socket, message.secret) : room.pair.viewer !== socket) return
    const signal = filterSignal(message.signal, host)
    if (!signal) return
    const recipient = host ? room.pair.viewer : room.host
    recipient.emit('peer:signal', { pairId: room.pair.id, signal })
  })

  socket.on('disconnect', () => {
    const room: Room | undefined = socket.data.room
    if (!room) return
    if (room.host === socket) {
      closeRoom(room)
    } else if (room.pair?.viewer === socket) {
      room.host.emit('pair:left', room.pair.id)
      delete room.pair
    }
  })
})

const port = Number(process.env.PORT || '3000')
http.listen(port, listenHost, () => {
  const localHost = listenHost === '0.0.0.0' ? '127.0.0.1' : listenHost
  console.log(`ScreenShare em http://${localHost}:${port}`)
  if (viewerOrigin) console.log(`Origem do link do espectador: ${viewerOrigin.origin}`)
})
