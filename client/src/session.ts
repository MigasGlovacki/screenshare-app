import type { Room, Track } from 'livekit-client'

export const qualities = {
  standard: { width: 1280, height: 720, fps: 30, bitrate: 3_000_000 },
  high: { width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
}
export type Quality = (typeof qualities)[keyof typeof qualities]
export type Participant = { id: string; name: string; host: boolean; local: boolean }
export type RoomState = {
  participants: Participant[]
  video?: Track
  audio?: Track
  reconnecting?: boolean
}

type SessionOptions = { role: 'host'; stream: MediaStream; quality: Quality } | { role: 'viewer'; id: string }
type RoomAccess = { id: string; url: string; token: string; secret?: string; viewerOrigin?: string }

const endedMessage = 'Esta transmissão já terminou ou o link não está ativo.'

export class RoomAccessError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
  }
}

function roomEndpoint(id?: string) {
  return id === undefined ? '/api/room' : `/api/room?id=${encodeURIComponent(id)}`
}

async function requestAccess(id?: string): Promise<RoomAccess> {
  const response = await fetch(roomEndpoint(id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new RoomAccessError(body?.error || 'Não foi possível entrar na sala.', response.status)
  }
  return response.json()
}

function inviteLink({ id, viewerOrigin }: RoomAccess) {
  const { hostname, origin } = window.location
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  const destination = local && viewerOrigin ? URL.parse(viewerOrigin) : null
  const base = destination && ['http:', 'https:'].includes(destination.protocol) ? destination.origin : origin
  return new URL(`/s/${id}`, base).href
}

export function createSession(options: SessionOptions, onState: (state: RoomState) => void, onEnd: (error?: string) => void) {
  const host = options.role === 'host'
  let room: Room | undefined
  let access: RoomAccess | undefined
  let closed = false
  let ready = false

  function close() {
    if (closed) return
    closed = true
    if (access?.secret) {
      void fetch(roomEndpoint(access.id), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${access.secret}` },
        keepalive: true,
      }).catch(() => undefined)
    }
    void room?.disconnect().catch(() => undefined)
  }

  function finish(error?: string) {
    if (closed) return
    close()
    onEnd(error)
  }

  async function connect() {
    const [{ ConnectionState, Room, RoomEvent, Track }, credentials] = await Promise.all([
      import('livekit-client'),
      requestAccess(options.role === 'viewer' ? options.id : undefined),
    ])
    if (closed) return
    access = credentials
    const connection = new Room({ adaptiveStream: true, dynacast: true })
    room = connection

    function sync() {
      if (closed || !ready) return
      const participants = [connection.localParticipant, ...connection.remoteParticipants.values()].map((participant) => ({
        id: participant.identity,
        name: participant.name || 'Convidado',
        host: participant.identity === 'host',
        local: participant === connection.localParticipant,
      }))
      const presenter = host ? connection.localParticipant : connection.remoteParticipants.get('host')
      onState({
        participants,
        video: presenter?.getTrackPublication(Track.Source.ScreenShare)?.track,
        audio: host ? undefined : presenter?.getTrackPublication(Track.Source.ScreenShareAudio)?.track,
        reconnecting: connection.state !== ConnectionState.Connected,
      })
    }

    function checkPresenter() {
      if (ready && !host && connection.state === ConnectionState.Connected && !connection.remoteParticipants.has('host')) finish()
    }

    connection.on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        // A full reconnect removes participants before the SDK updates the connection state.
        if (participant.identity === 'host') queueMicrotask(checkPresenter)
        sync()
      })
      .on(RoomEvent.TrackSubscribed, sync)
      .on(RoomEvent.TrackUnsubscribed, sync)
      .on(RoomEvent.TrackSubscriptionFailed, (sid, participant) => {
        if (participant.identity === 'host' && participant.getTrackPublication(Track.Source.ScreenShare)?.trackSid === sid) {
          finish('Não foi possível receber o vídeo da transmissão. Tente entrar novamente.')
        }
      })
      .on(RoomEvent.ConnectionStateChanged, sync)
      .on(RoomEvent.Reconnected, checkPresenter)
      .on(RoomEvent.Disconnected, () => {
        if (ready) finish(host ? 'A conexão com o servidor de vídeo foi perdida.' : undefined)
      })

    await connection.connect(credentials.url, credentials.token, { autoSubscribe: !host })
    if (closed) return
    if (options.role === 'host') {
      const [video] = options.stream.getVideoTracks()
      await connection.localParticipant.publishTrack(video, {
        source: Track.Source.ScreenShare,
        screenShareEncoding: { maxBitrate: options.quality.bitrate, maxFramerate: options.quality.fps },
      })
      const [audio] = options.stream.getAudioTracks()
      if (!closed && audio?.readyState === 'live') {
        await connection.localParticipant.publishTrack(audio, { source: Track.Source.ScreenShareAudio })
      }
    } else if (!connection.remoteParticipants.has('host')) {
      throw new RoomAccessError(endedMessage, 404)
    }
    if (closed) return
    if (connection.state === ConnectionState.Disconnected) throw new Error('A conexão com a sala foi perdida.')
    ready = true
    sync()
    return host ? inviteLink(credentials) : undefined
  }

  return { connect, close }
}
