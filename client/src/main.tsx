import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, Link2, LogOut, Maximize, Monitor, MonitorUp, Play, SlidersHorizontal, Square, Users, Volume2, VolumeX, X } from 'lucide-react'
import { createSession, qualities, RoomAccessError, type Participant, type RoomState } from './session'
import './style.css'

type Phase = 'idle' | 'capturing' | 'connecting' | 'ready' | 'ended' | 'error'
const emptyRoom: RoomState = { participants: [] }
const localHost: Participant = { id: 'host', name: 'Anfitrião', host: true, local: true }

function Participants({ people, open }: { people: Participant[]; open: boolean }) {
  const ordered = [...people].sort((first, second) => Number(second.host) - Number(first.host) || Number(second.local) - Number(first.local))

  return <aside className="people-panel" id="people" aria-labelledby="people-title" hidden={!open}>
    <div className="people-heading"><h2 id="people-title">Na sala</h2><span>{people.length}</span></div>
    {ordered.length
      ? <ul className="people-list">{ordered.map((person) => <li className="person" key={person.id} data-host={person.host}>
        <span className="avatar" aria-hidden="true" data-tone={person.id.charCodeAt(person.id.length - 1) % 3}>
          {person.host ? <Monitor size={22} /> : (person.name.split(' ').at(-1) || 'C').slice(0, 2)}
        </span>
        <span className="person-caption"><strong>{person.name}</strong>{person.local && <small>Você</small>}</span>
      </li>)}</ul>
      : <p className="people-empty">Ninguém na sala no momento.</p>}
  </aside>
}

function usePlayback(state: RoomState) {
  const video = useRef<HTMLVideoElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const [needsPlay, setNeedsPlay] = useState(false)
  const [soundOn, setSoundOn] = useState(true)
  const [mediaError, setMediaError] = useState('')

  useEffect(() => {
    const element = video.current
    const track = state.video
    setNeedsPlay(false)
    setMediaError('')
    if (!track || !element) return
    let current = true
    track.attach(element)
    void element.play().catch(() => { if (current) setNeedsPlay(true) })
    return () => {
      current = false
      track.detach(element)
    }
  }, [state.video])

  useEffect(() => {
    const element = audio.current
    const track = state.audio
    if (!track || !element) return
    let current = true
    track.attach(element)
    element.muted = !soundOn
    if (soundOn) void element.play().catch(() => { if (current) setSoundOn(false) })
    return () => {
      current = false
      track.detach(element)
    }
  }, [state.audio, soundOn])

  function toggleSound() {
    const element = audio.current
    if (soundOn || !element) {
      setSoundOn(false)
      return
    }
    element.muted = false
    void element.play().then(() => setSoundOn(true)).catch(() => setSoundOn(false))
  }

  async function fullscreen() {
    const element = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    try {
      if (element?.requestFullscreen) await element.requestFullscreen()
      else if (element?.webkitEnterFullscreen) element.webkitEnterFullscreen()
      else throw new Error()
      setMediaError('')
    } catch {
      setMediaError('Tela cheia indisponível neste navegador.')
    }
  }

  function play() {
    void video.current?.play().then(() => setNeedsPlay(false)).catch(() => setMediaError('Não foi possível reproduzir o vídeo.'))
  }

  return { video, audio, needsPlay, soundOn, mediaError, toggleSound, fullscreen, play }
}

function Stage({ player, hasVideo, viewer, phase, detail, onStart, onRetry }: {
  player: ReturnType<typeof usePlayback>
  hasVideo: boolean
  viewer: boolean
  phase: Phase
  detail: string
  onStart?: () => void
  onRetry: () => void
}) {
  const title = phase === 'ended' ? 'Transmissão encerrada'
    : phase === 'error' ? 'Conexão indisponível'
    : phase === 'capturing' ? 'Escolha o que compartilhar'
    : phase === 'connecting' ? 'Conectando à sala'
    : viewer ? 'Aguardando a transmissão' : 'Compartilhe sua tela'
  const message = detail || (viewer ? 'O vídeo aparece aqui quando estiver disponível.'
    : phase === 'capturing' ? 'Use o seletor do navegador para escolher uma fonte.'
    : phase === 'connecting' ? 'Preparando o vídeo e o link de convite.'
    : 'Escolha uma tela, janela ou aba no navegador. Depois, envie o convite para seus amigos.')

  return <section className="stage" data-video={hasVideo} aria-label={viewer ? 'Tela compartilhada' : 'Prévia da transmissão'}>
    <video ref={player.video} hidden={!hasVideo} autoPlay playsInline muted />
    <audio ref={player.audio} />
    {hasVideo && <span className="stage-caption"><Monitor size={15} />{viewer ? 'Tela compartilhada' : 'Sua prévia'}</span>}
    {!hasVideo && <div className="stage-empty">
      <span className="stage-symbol"><MonitorUp size={31} strokeWidth={1.65} aria-hidden="true" /></span>
      <div role={phase === 'error' ? 'alert' : 'status'}>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
      {onStart && <button className="button primary" onClick={onStart}><MonitorUp size={19} />Compartilhar tela</button>}
      {viewer && (phase === 'error' || phase === 'ended') && <button className="button secondary" onClick={onRetry}>Tentar novamente</button>}
    </div>}
    {hasVideo && player.needsPlay && <button className="button primary play" onClick={player.play}><Play size={17} />Reproduzir vídeo</button>}
    {player.mediaError && <p className="media-error" role="alert">{player.mediaError}</p>}
  </section>
}

function ElapsedTime() {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const clock = [minutes, seconds % 60].map((part) => String(part).padStart(2, '0')).join(':')
  return <time className="elapsed" dateTime={`PT${seconds}S`} aria-label="Duração da transmissão">{hours ? `${hours}:${clock}` : clock}</time>
}

function Workspace({ viewerId }: { viewerId?: string }) {
  const viewer = viewerId !== undefined
  const [phase, setPhase] = useState<Phase>(viewer ? 'connecting' : 'idle')
  const [detail, setDetail] = useState('')
  const [room, setRoom] = useState<RoomState>(emptyRoom)
  const [link, setLink] = useState('')
  const [copy, setCopy] = useState<'idle' | 'copied' | 'fallback'>('idle')
  const [attempt, setAttempt] = useState(0)
  const [quality, setQuality] = useState<keyof typeof qualities>('standard')
  const [shareAudio, setShareAudio] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const session = useRef<ReturnType<typeof createSession> | null>(null)
  const capture = useRef<MediaStream | null>(null)
  const mounted = useRef(true)
  const linkInput = useRef<HTMLInputElement>(null)
  const settingsToggle = useRef<HTMLButtonElement>(null)
  const settingsPanel = useRef<HTMLDivElement>(null)
  const player = usePlayback(room)

  function end(nextPhase: Phase, message = '') {
    session.current?.close()
    session.current = null
    capture.current?.getTracks().forEach((track) => track.stop())
    capture.current = null
    setRoom(emptyRoom)
    setLink('')
    setCopy('idle')
    setPhase(nextPhase)
    setDetail(message)
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      session.current?.close()
      capture.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    if (viewerId === undefined) return
    setPhase('connecting')
    setDetail('')
    const current = createSession({ role: 'viewer', id: viewerId }, setRoom, (error) => {
      end(error ? 'error' : 'ended', error || 'O anfitrião encerrou a transmissão ou saiu da sala.')
    })
    session.current = current
    void current.connect().then(() => {
      if (session.current === current) setPhase('ready')
    }).catch((error) => {
      if (session.current !== current) return
      if (error instanceof RoomAccessError) end(error.status === 404 ? 'ended' : 'error', error.message)
      else end('error', 'Não foi possível se conectar à sala. Tente novamente.')
    })
    return () => {
      current.close()
      if (session.current === current) session.current = null
    }
  }, [viewerId, attempt])

  useEffect(() => {
    if (copy !== 'fallback') return
    linkInput.current?.focus()
    linkInput.current?.select()
  }, [copy])

  useEffect(() => {
    if (settingsOpen) settingsPanel.current?.querySelector<HTMLInputElement>('input:checked')?.focus()
  }, [settingsOpen])

  function closeSettings() {
    setSettingsOpen(false)
    settingsToggle.current?.focus()
  }

  async function start() {
    setSettingsOpen(false)
    if (!navigator.mediaDevices?.getDisplayMedia) {
      end('error', 'Para compartilhar, abra o app em HTTPS ou localhost em um navegador desktop compatível.')
      return
    }
    const preset = qualities[quality]
    setPhase('capturing')
    setDetail('')
    let selected: MediaStream
    try {
      selected = await navigator.mediaDevices.getDisplayMedia({
        audio: shareAudio,
        video: {
          width: { ideal: preset.width, max: preset.width },
          height: { ideal: preset.height, max: preset.height },
          frameRate: { ideal: preset.fps, max: preset.fps },
        },
      })
    } catch (error) {
      if (!mounted.current) return
      const canceled = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')
      if (canceled) end('idle', 'Captura cancelada. Você pode escolher uma fonte quando quiser.')
      else end('error', 'Não foi possível capturar a tela. Tente escolher outra fonte.')
      return
    }
    if (!mounted.current) {
      selected.getTracks().forEach((track) => track.stop())
      return
    }
    capture.current = selected
    const [video] = selected.getVideoTracks()
    if (!video || video.readyState === 'ended') {
      end('error', 'A captura foi interrompida. Selecione outra fonte para continuar.')
      return
    }
    video.addEventListener('ended', () => {
      if (capture.current === selected) end('ended', 'A captura foi interrompida no navegador.')
    }, { once: true })
    setPhase('connecting')
    const current = createSession({ role: 'host', stream: selected, quality: preset }, setRoom, (error) => {
      end(error ? 'error' : 'ended', error)
    })
    session.current = current
    try {
      const invite = await current.connect()
      if (session.current !== current || !invite) return
      setLink(invite)
      setPhase('ready')
    } catch (error) {
      if (session.current !== current) return
      end('error', error instanceof RoomAccessError ? error.message : 'Não foi possível iniciar o vídeo. Tente novamente.')
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopy('copied')
    } catch {
      setCopy('fallback')
    }
  }

  const people = room.participants.length || viewer ? room.participants : [localHost]
  const broadcasting = !viewer && phase === 'ready'
  const busy = phase === 'capturing' || phase === 'connecting'
  const live = phase === 'ready' && Boolean(room.video)
  const canConfigure = !viewer && !busy && !broadcasting
  const status = room.reconnecting ? 'Reconectando' : live ? 'Ao vivo' : phase === 'capturing' ? 'Escolhendo tela'
    : busy || phase === 'ready' ? 'Conectando' : phase === 'ended' ? 'Encerrada' : phase === 'error' ? 'Indisponível' : 'Fora do ar'

  return <div className="app-shell">
    <header className="room-header">
      <div className="room-title">
        <div className="brand"><span className="brand-mark"><MonitorUp size={23} strokeWidth={1.85} /></span><span className="brand-name">ScreenShare</span></div>
        <h1>Sala de transmissão</h1>
      </div>
      <div className="session-status">
        <span className="status" data-live={live && !room.reconnecting} data-pending={busy || room.reconnecting} role="status"><i aria-hidden="true" />{status}</span>
        {broadcasting && <ElapsedTime />}
      </div>
    </header>

    <main className="room-body">
      <div className="workspace" data-people={peopleOpen}>
        <Stage player={player} hasVideo={Boolean(room.video)} viewer={viewer} phase={phase} detail={detail} onStart={canConfigure ? start : undefined} onRetry={() => setAttempt((value) => value + 1)} />
        <Participants people={people} open={peopleOpen} />
      </div>

      <footer className="dock-zone" onKeyDown={(event) => {
        if (event.key === 'Escape' && settingsOpen) closeSettings()
      }}>
        {canConfigure && <div className="dock-tray settings" id="share-settings" ref={settingsPanel} hidden={!settingsOpen}>
          <div className="tray-header"><h2>Ajustes da transmissão</h2><button className="close-button" aria-label="Fechar ajustes" onClick={closeSettings}><X size={18} /></button></div>
          <fieldset>
            <legend>Qualidade do vídeo</legend>
            <div className="quality-options">
              {Object.entries(qualities).map(([key, preset]) => <label className="quality-option" key={key}>
                <input type="radio" name="quality" value={key} checked={quality === key} onChange={() => setQuality(key as keyof typeof qualities)} />
                <span><strong>{preset.height}p</strong><small>{preset.fps} FPS</small></span>
              </label>)}
            </div>
          </fieldset>
          <label className="audio-setting"><input type="checkbox" checked={shareAudio} onChange={(event) => setShareAudio(event.target.checked)} />Áudio da tela</label>
        </div>}
        {link && copy === 'fallback' && <div className="dock-tray invite-fallback">
          <label>Copie o link da sala<input ref={linkInput} readOnly aria-label="Link de convite" value={link} onFocus={(event) => event.currentTarget.select()} /></label>
        </div>}

        <div className="dock" role="group" aria-label="Controles da sala">
          {canConfigure && <button className="dock-button" ref={settingsToggle} aria-controls="share-settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}><SlidersHorizontal size={20} /><span>Ajustes</span></button>}
          <button className="dock-button" onClick={() => setPeopleOpen(!peopleOpen)} aria-controls="people" aria-expanded={peopleOpen} aria-label="Participantes">
            <Users size={20} /><span>Pessoas <small>{people.length}</small></span>
          </button>
          {link && <button className="dock-button" onClick={copyLink} data-copied={copy === 'copied'} aria-label={copy === 'copied' ? 'Link copiado' : 'Copiar link de convite'}>
            {copy === 'copied' ? <Check size={20} /> : <Link2 size={20} />}<span>{copy === 'copied' ? 'Copiado' : 'Convite'}</span>
          </button>}
          {room.audio && <button className="dock-button" onClick={player.toggleSound} aria-label={player.soundOn ? 'Silenciar áudio' : 'Ativar áudio'}>
            {player.soundOn ? <Volume2 size={20} /> : <VolumeX size={20} />}<span>{player.soundOn ? 'Som' : 'Mudo'}</span>
          </button>}
          {room.video && <button className="dock-button" onClick={player.fullscreen} aria-label="Tela cheia"><Maximize size={20} /><span>Tela cheia</span></button>}
          {viewer && <a className="dock-button dock-leave" href="/" aria-label="Sair da sala" onClick={() => session.current?.close()}><LogOut size={19} /><span>Sair</span></a>}
          {(broadcasting || (!viewer && phase === 'connecting' && capture.current)) && <button className="dock-button stop" aria-label="Parar transmissão" onClick={() => end('ended', 'Você encerrou a transmissão. O convite expirou.')}><Square size={16} /><span>Parar</span></button>}
        </div>
      </footer>
    </main>
  </div>
}

const route = window.location.pathname.match(/^\/s\/([^/]+)\/?$/)
createRoot(document.getElementById('root')!).render(<Workspace viewerId={route?.[1]} />)
