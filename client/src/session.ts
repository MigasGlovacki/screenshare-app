import type { Room, Track } from 'livekit-client'

export const qualities = {
  standard: { width: 1280, height: 720, fps: 30, bitrate: 3_000_000 },
  high: { width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
}
export type Quality = (typeof qualities)[keyof typeof qualities]
export type Participant = { id: string; name: string; host: boolean; local: boolean }
export type ScreenShare = {
  presenter: Participant
  video?: Track
  audio?: Track
  hasSharedAudio: boolean
  subscriptionFailed: boolean
}
export type RoomState = {
  participants: Participant[]
  shares: ScreenShare[]
  reconnecting?: boolean
}

type SessionOptions = { role: 'host' } | { role: 'viewer'; id: string }
type RoomAccess = { id: string; url: string; token: string; secret?: string; viewerOrigin?: string }

const endedMessage = 'Esta sala já foi encerrada ou o link não está ativo.'

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
  let sources: typeof Track.Source | undefined
  let publishing: Promise<void> | undefined

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
    sources = Track.Source
    const connection = new Room({ adaptiveStream: true, dynacast: true })
    const failedTracks = new Set<string>()
    room = connection

    function sync() {
      if (closed || !ready) return
      const participants: Participant[] = []
      const shares: ScreenShare[] = []
      for (const participant of [connection.localParticipant, ...connection.remoteParticipants.values()]) {
        const presenter = {
          id: participant.identity,
          name: participant.name || 'Convidado',
          host: participant.identity === 'host',
          local: participant === connection.localParticipant,
        }
        participants.push(presenter)
        const video = participant.getTrackPublication(Track.Source.ScreenShare)
        if (!video) continue
        const audio = participant.getTrackPublication(Track.Source.ScreenShareAudio)
        shares.push({
          presenter,
          video: video.track,
          audio: presenter.local ? undefined : audio?.track,
          hasSharedAudio: Boolean(audio && audio.track?.mediaStreamTrack.readyState !== 'ended'),
          subscriptionFailed: failedTracks.has(video.trackSid),
        })
      }
      onState({
        participants,
        shares,
        reconnecting: connection.state !== ConnectionState.Connected,
      })
    }

    function checkHost() {
      if (ready && !host && connection.state === ConnectionState.Connected && !connection.remoteParticipants.has('host')) finish()
    }

    connection.on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        // A full reconnect removes participants before the SDK updates the connection state.
        if (participant.identity === 'host') queueMicrotask(checkHost)
        sync()
      })
      .on(RoomEvent.TrackSubscribed, (_track, publication) => {
        failedTracks.delete(publication.trackSid)
        sync()
      })
      .on(RoomEvent.TrackUnsubscribed, sync)
      .on(RoomEvent.TrackPublished, sync)
      .on(RoomEvent.TrackUnpublished, (publication) => {
        failedTracks.delete(publication.trackSid)
        sync()
      })
      .on(RoomEvent.LocalTrackPublished, sync)
      .on(RoomEvent.LocalTrackUnpublished, sync)
      .on(RoomEvent.TrackSubscriptionFailed, (sid, participant) => {
        if (participant.getTrackPublication(Track.Source.ScreenShare)?.trackSid === sid) {
          failedTracks.add(sid)
          sync()
        }
      })
      .on(RoomEvent.ConnectionStateChanged, sync)
      .on(RoomEvent.Reconnected, () => {
        failedTracks.clear()
        checkHost()
        sync()
      })
      .on(RoomEvent.Disconnected, () => {
        if (ready) finish(host ? 'A conexão com o servidor de vídeo foi perdida.' : undefined)
      })

    await connection.connect(credentials.url, credentials.token)
    if (closed) return
    if (!host && !connection.remoteParticipants.has('host')) {
      throw new RoomAccessError(endedMessage, 404)
    }
    if (closed) return
    if (connection.state === ConnectionState.Disconnected) throw new Error('A conexão com a sala foi perdida.')
    ready = true
    sync()
    return host ? inviteLink(credentials) : undefined
  }

  async function startSharing(stream: MediaStream, quality: Quality) {
    const connection = room
    const trackSources = sources
    const [video] = stream.getVideoTracks()
    const [audio] = stream.getAudioTracks()
    if (closed || !ready || !connection || !trackSources || video?.readyState !== 'live' || publishing) {
      throw new Error('A sala não está pronta para transmitir.')
    }

    const participant = connection.localParticipant
    publishing = (async () => {
      await participant.publishTrack(video, {
        source: trackSources.ScreenShare,
        screenShareEncoding: { maxBitrate: quality.bitrate, maxFramerate: quality.fps },
      })
      if (!closed && video.readyState === 'live' && audio?.readyState === 'live') {
        try {
          await participant.publishTrack(audio, { source: trackSources.ScreenShareAudio })
        } catch {
          audio.stop()
        }
      }
    })()
    try {
      await publishing
      return participant.identity
    } finally {
      publishing = undefined
    }
  }

  async function stopSharing(stream: MediaStream) {
    // Let in-flight publishing finish before removing its tracks from the room.
    await publishing?.catch(() => undefined)
    if (closed || !room) return
    const participant = room.localParticipant
    const tracks = stream.getTracks().filter((track) => participant.getTrackPublications()
      .some((publication) => publication.track?.mediaStreamTrack === track))
    await participant.unpublishTracks(tracks)
  }

  return { connect, close, startSharing, stopSharing }
}
