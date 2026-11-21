import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { AccessToken, ParticipantInfo_State, RoomServiceClient, TrackSource } from 'livekit-server-sdk'

const hostIdentity = 'host'
const roomIdPattern = /^[a-f0-9]{32}$/

function readConfig() {
  const url = process.env.LIVEKIT_URL?.trim()
  const key = process.env.LIVEKIT_API_KEY?.trim()
  const secret = process.env.LIVEKIT_API_SECRET?.trim()
  if (!url || !key || !secret) return
  const endpoint = URL.parse(url)
  if (!endpoint || !['ws:', 'wss:'].includes(endpoint.protocol)) return
  endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:'
  return { url, key, secret, service: new RoomServiceClient(endpoint.href, key, secret, { requestTimeout: 8 }) }
}

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function hostSecret(roomId: string, secret: string) {
  return createHmac('sha256', secret).update(`screenshare:close:${roomId}`).digest('hex')
}

function isMissing(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'not_found'
}

async function issueToken(config: NonNullable<ReturnType<typeof readConfig>>, id: string, host: boolean) {
  const guestCode = randomBytes(8).toString('hex')
  const token = new AccessToken(config.key, config.secret, {
    identity: host ? hostIdentity : `guest-${guestCode}`,
    name: host ? 'Anfitrião' : `Convidado ${guestCode.slice(0, 4).toUpperCase()}`,
    ttl: '2m',
  })
  token.addGrant({
    room: id,
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishSources: [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    canPublishData: false,
  })
  return token.toJwt()
}

export const roomFunction = {
  async fetch(request: Request): Promise<Response> {
    const id = new URL(request.url).searchParams.get('id')
    if (id !== null && !roomIdPattern.test(id)) return reply({ error: 'Link de convite inválido.' }, 400)
    if (request.method !== 'POST' && request.method !== 'DELETE') {
      return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } })
    }
    if (request.method === 'POST' && request.headers.get('content-type') !== 'application/json') {
      return reply({ error: 'Requisição inválida.' }, 415)
    }
    const config = readConfig()
    if (!config) return reply({ error: 'Servidor de vídeo indisponível. Configure o LiveKit para começar.' }, 503)

    try {
      if (request.method === 'DELETE') {
        const authorization = request.headers.get('authorization')
        const credential = authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
        if (!id || !credential || !timingSafeEqual(Buffer.from(credential, 'hex'), Buffer.from(hostSecret(id, config.secret), 'hex'))) {
          return reply({ error: 'Somente o anfitrião pode encerrar a sala.' }, 403)
        }
        try {
          await config.service.deleteRoom(id)
        } catch (error) {
          if (!isMissing(error)) throw error
        }
        return reply({ ok: true })
      }

      if (id) {
        const host = await config.service.getParticipant(id, hostIdentity).catch((error: unknown) => {
          if (isMissing(error)) return null
          throw error
        })
        if (!host || host.state === ParticipantInfo_State.DISCONNECTED) {
          return reply({ error: 'Esta sala já foi encerrada ou o link não está ativo.' }, 404)
        }
        return reply({ id, url: config.url, token: await issueToken(config, id, false) })
      }

      // LiveKit creates the room on the first connection with the host token.
      const newId = randomBytes(16).toString('hex')
      return reply({
        id: newId,
        url: config.url,
        token: await issueToken(config, newId, true),
        secret: hostSecret(newId, config.secret),
        viewerOrigin: process.env.VIEWER_ORIGIN?.trim() || undefined,
      }, 201)
    } catch {
      return reply({ error: 'Não foi possível acessar o servidor de vídeo. Tente novamente.' }, 502)
    }
  },
}
