import { io } from 'socket.io-client'

export const qualities = {
  standard: { label: '720p / 30 FPS', width: 1280, height: 720, fps: 30, bitrate: 3_000_000 },
  high: { label: '1080p / 60 FPS', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
}
export type Quality = (typeof qualities)[keyof typeof qualities]
export type Status = { label: string; tone?: 'live' | 'pending' | 'error'; detail?: string }

type Signal =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit }

type Options =
  | { role: 'host'; stream: MediaStream; quality: Quality; onRoom: (id: string, viewerOrigin?: string) => void }
  | { role: 'viewer'; id: string; onStream: (stream: MediaStream | null) => void }

type Reply = { error: string } | {
  id: string
  secret?: string
  iceServers: RTCIceServer[]
  viewerOrigin?: string
}

export function openSession(options: Options, onStatus: (status: Status) => void,
  onClosed: (status: Status) => void) {
  const socket = io({ transports: ['websocket'], autoConnect: false, reconnection: false, timeout: 8_000 })
  let iceServers: RTCIceServer[] = []
  let secret: string | undefined
  let pair: { id: string; close: () => void; receive: (signal: Signal) => void } | undefined

  function resetPair() {
    pair?.close()
    pair = undefined
    if (options.role === 'viewer') options.onStream(null)
  }

  function close() {
    resetPair()
    socket.removeAllListeners()
    socket.disconnect()
  }

  function finish(status: Status) {
    close()
    onClosed(status)
  }

  function serverUnavailable() {
    finish({ label: 'Conexão perdida', tone: 'error', detail: 'A conexão com o servidor foi interrompida.' })
  }

  socket.on('connect_error', serverUnavailable)
  socket.on('disconnect', serverUnavailable)
  socket.on('room:ended', () => finish({ label: 'Transmissão encerrada' }))
  socket.on('connect', async () => {
    try {
      const request = socket.timeout(8_000)
      const reply: Reply = await (options.role === 'host'
        ? request.emitWithAck('room:create')
        : request.emitWithAck('room:join', options.id))
      if (!socket.connected) return
      if ('error' in reply) {
        finish({ label: 'Sala indisponível', tone: 'error', detail: reply.error })
        return
      }
      iceServers = reply.iceServers
      secret = reply.secret
      if (options.role === 'host') {
        options.onRoom(reply.id, reply.viewerOrigin)
        onStatus({ label: 'Aguardando espectador', tone: 'pending' })
      }
    } catch {
      if (socket.connected) serverUnavailable()
    }
  })

  socket.on('pair:left', (id: string) => {
    if (pair?.id !== id) return
    resetPair()
    onStatus({ label: 'Aguardando espectador', tone: 'pending' })
  })

  socket.on('pair:start', (id: string) => {
    resetPair()
    onStatus({ label: 'Conectando vídeo', tone: 'pending' })
    try {
      pair = createPeer(id, options, iceServers, (signal) => {
        socket.emit('peer:signal', { pairId: id, secret, signal })
      }, onStatus)
    } catch {
      onStatus({ label: 'WebRTC indisponível', tone: 'error', detail: 'Use um navegador compatível e atualizado.' })
    }
  })

  socket.on('peer:signal', ({ pairId, signal }: { pairId: string; signal: Signal }) => {
    if (pair?.id === pairId) pair.receive(signal)
  })

  socket.connect()
  return {
    close,
    stop() {
      if (socket.connected && secret) socket.emit('room:stop', secret)
      close()
    },
  }
}

function createPeer(id: string, options: Options, iceServers: RTCIceServer[],
  send: (signal: Signal) => void, onStatus: (status: Status) => void) {
  const peer = new RTCPeerConnection({ iceServers })
  const pendingIce: RTCIceCandidateInit[] = []
  let work = Promise.resolve()
  let closed = false
  let connectionTimeout: ReturnType<typeof setTimeout> | undefined

  function fail(detail: string) {
    close()
    onStatus({ label: 'Falha na conexão de vídeo', tone: 'error', detail })
  }

  function close() {
    closed = true
    clearTimeout(connectionTimeout)
    peer.close()
    if (options.role === 'viewer') options.onStream(null)
  }

  function enqueue(task: () => Promise<void>) {
    work = work.then(async () => {
      if (!closed) await task()
    }).catch(() => {
      if (!closed) fail('Houve um erro ao negociar o vídeo. Reabra o link para tentar novamente.')
    })
  }

  function setConnectionTimeout() {
    clearTimeout(connectionTimeout)
    connectionTimeout = setTimeout(() => {
      fail('Os navegadores não conseguiram trocar vídeo. Tente reabrir o link ou configure um servidor TURN.')
    }, 20_000)
  }

  async function sendDescription(description: RTCSessionDescriptionInit) {
    await peer.setLocalDescription(description)
    const local = peer.localDescription
    if (!closed && local && (local.type === 'offer' || local.type === 'answer')) {
      send({ type: local.type, sdp: local.sdp })
    }
  }

  peer.onicecandidate = ({ candidate }) => {
    if (!closed && candidate) send({ type: 'ice', candidate: candidate.toJSON() })
  }
  peer.onconnectionstatechange = () => {
    if (closed) return
    switch (peer.connectionState) {
      case 'connected':
        clearTimeout(connectionTimeout)
        onStatus({ label: 'Ao vivo', tone: 'live' })
        break
      case 'disconnected':
        onStatus({ label: 'Conexão instável', tone: 'pending' })
        setConnectionTimeout()
        break
      case 'failed':
        fail('Os navegadores não conseguiram trocar vídeo. Tente reabrir o link ou configure um servidor TURN.')
    }
  }

  try {
    if (options.role === 'host') {
      const [track] = options.stream.getVideoTracks()
      peer.addTransceiver(track, {
        direction: 'sendonly',
        streams: [options.stream],
        sendEncodings: [{ maxBitrate: options.quality.bitrate, maxFramerate: options.quality.fps }],
      })
      enqueue(async () => sendDescription(await peer.createOffer()))
    } else {
      peer.ontrack = ({ track, streams }) => {
        if (!closed && track.kind === 'video') options.onStream(streams[0] ?? new MediaStream([track]))
      }
    }
  } catch (error) {
    close()
    throw error
  }
  setConnectionTimeout()

  return {
    id,
    close,
    receive(signal: Signal) {
      enqueue(async () => {
        if (signal.type === 'ice') {
          if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate)
          else pendingIce.push(signal.candidate)
          return
        }
        await peer.setRemoteDescription(signal)
        for (const candidate of pendingIce) await peer.addIceCandidate(candidate)
        pendingIce.length = 0
        if (signal.type === 'offer') await sendDescription(await peer.createAnswer())
      })
    },
  }
}
