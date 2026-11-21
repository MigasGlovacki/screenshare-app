import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, Link2, LogOut, Maximize, Monitor, MonitorUp, Play, SlidersHorizontal, Square, Users, Volume2, VolumeX, X } from 'lucide-react'
import { createSession, qualities, RoomAccessError, type Participant, type RoomState, type ScreenShare } from './session'
import './style.css'

type Phase = 'idle' | 'connecting' | 'ready' | 'ended' | 'error'
type CapturePhase = 'idle' | 'picking' | 'publishing' | 'live' | 'stopping'
const emptyRoom: RoomState = { participants: [], shares: [] }
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

function usePlayback(share?: ScreenShare) {
  const video = useRef<HTMLVideoElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const [needsPlay, setNeedsPlay] = useState(false)
  const [sound, setSound] = useState<'playing' | 'muted' | 'blocked'>('playing')
  const [mediaError, setMediaError] = useState('')
  const mutedByViewer = useRef(false)
  const playbackAttempt = useRef(0)

  useEffect(() => {
    const element = video.current
    const track = share?.video
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
  }, [share?.video])

  function playAudio(element: HTMLAudioElement) {
    const attempt = ++playbackAttempt.current
    element.muted = false
    void element.play().then(() => {
      if (attempt === playbackAttempt.current) setSound('playing')
    }).catch(() => {
      if (attempt !== playbackAttempt.current) return
      element.muted = true
      setSound('blocked')
    })
  }

  useEffect(() => {
    const element = audio.current
    const track = share?.audio
    if (!track || !element) return
    track.attach(element)
    element.muted = mutedByViewer.current
    if (mutedByViewer.current) setSound('muted')
    else playAudio(element)
    return () => {
      playbackAttempt.current++
      track.detach(element)
    }
  }, [share?.audio])

  function toggleSound() {
    const element = audio.current
    if (!element) return
    if (sound === 'playing' && !element.paused && !element.muted) {
      playbackAttempt.current++
      mutedByViewer.current = true
      element.muted = true
      setSound('muted')
      return
    }
    mutedByViewer.current = false
    playAudio(element)
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

  return { video, audio, needsPlay, sound, mediaError, toggleSound, fullscreen, play }
}

function CaptureAudio({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  return <label className="capture-audio"><input type="checkbox" checked={enabled} onChange={(event) => onChange(event.target.checked)} />Incluir áudio da tela</label>
}

function Stage({ player, share, reconnecting, viewer, phase, capturePhase, detail, audioRequested, onAudioChange, onStart, onRetry }: {
  player: ReturnType<typeof usePlayback>
  share?: ScreenShare
  reconnecting?: boolean
  viewer: boolean
  phase: Phase
  capturePhase: CapturePhase
  detail: string
  audioRequested: boolean
  onAudioChange: (enabled: boolean) => void
  onStart?: () => void
  onRetry: () => void
}) {
  const hasVideo = Boolean(share?.video)
  const localPreview = share?.presenter.local
  const title = phase === 'ended' ? 'Sala encerrada'
    : phase === 'error' ? 'Conexão indisponível'
    : capturePhase === 'picking' ? 'Escolha o que compartilhar'
    : capturePhase === 'stopping' ? 'Parando o compartilhamento'
    : phase === 'connecting' || reconnecting ? 'Conectando à sala'
    : share?.subscriptionFailed ? 'Vídeo indisponível'
    : capturePhase === 'publishing' || share ? 'Preparando o vídeo'
    : viewer ? 'Aguardando o compartilhamento' : phase === 'ready' ? 'A sala continua aberta' : 'Compartilhe sua tela'
  const message = detail || (phase === 'connecting' || reconnecting ? 'Aguarde enquanto a conexão é estabelecida.'
    : capturePhase === 'picking' ? 'Use o seletor do navegador para escolher uma fonte.'
    : share?.subscriptionFailed ? 'Aguarde uma nova transmissão ou escolha outra tela disponível.'
    : share || capturePhase === 'stopping' || capturePhase === 'publishing' ? ''
    : viewer ? 'O vídeo aparece aqui quando alguém compartilhar.'
    : phase === 'ready' ? 'Seus amigos podem entrar pelo mesmo link. Compartilhe outra fonte quando quiser.'
    : 'Escolha uma tela, janela ou aba no navegador. Depois, envie o convite para seus amigos.')

  const captureNotice = detail || (localPreview && capturePhase === 'live' && audioRequested && !share?.hasSharedAudio
    ? 'Sem áudio nesta transmissão. Para compartilhar som, escolha uma aba e ative o áudio no seletor do navegador.' : '')

  return <section className="stage" data-video={hasVideo} aria-label={localPreview ? 'Prévia da transmissão' : 'Tela compartilhada'}>
    <video ref={player.video} hidden={!hasVideo} autoPlay playsInline muted />
    <audio ref={player.audio} />
    {share && hasVideo && <span className="stage-caption"><Monitor size={15} />{localPreview ? 'Sua prévia' : `${share.presenter.name} · Tela compartilhada`}{!share.hasSharedAudio && <small>Sem áudio</small>}</span>}
    {!hasVideo && <div className="stage-empty">
      <span className="stage-symbol"><MonitorUp size={31} strokeWidth={1.65} aria-hidden="true" /></span>
      <div role={phase === 'error' ? 'alert' : 'status'}>
        <h2>{title}</h2>
        {message && <p>{message}</p>}
      </div>
      {onStart && <div className="capture-actions">
        <button className="button primary" onClick={onStart}><MonitorUp size={19} />Compartilhar tela</button>
        <CaptureAudio enabled={audioRequested} onChange={onAudioChange} />
        {audioRequested && <p className="audio-hint">Para enviar som, escolha uma aba com áudio e ative o áudio no seletor do navegador.</p>}
      </div>}
      {viewer && (phase === 'error' || phase === 'ended') && <button className="button secondary" onClick={onRetry}>Tentar novamente</button>}
    </div>}
    {hasVideo && player.needsPlay && <button className="button primary play" onClick={player.play}><Play size={17} />Reproduzir vídeo</button>}
    {share?.audio && player.sound === 'blocked' && <button className="button secondary audio-resume" onClick={player.toggleSound}><Volume2 size={17} />Ativar áudio</button>}
    {hasVideo && captureNotice && <p className="capture-notice" role="status">{captureNotice}</p>}
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
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle')
  const [detail, setDetail] = useState('')
  const [room, setRoom] = useState<RoomState>(emptyRoom)
  const [selectedPresenter, setSelectedPresenter] = useState<string>()
  const [link, setLink] = useState('')
  const [copy, setCopy] = useState<'idle' | 'copied' | 'fallback'>('idle')
  const [attempt, setAttempt] = useState(0)
  const [quality, setQuality] = useState<keyof typeof qualities>('standard')
  const [shareAudio, setShareAudio] = useState(true)
  const [peopleOpen, setPeopleOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const session = useRef<ReturnType<typeof createSession> | null>(null)
  const capture = useRef<MediaStream | null>(null)
  const mounted = useRef(true)
  const linkInput = useRef<HTMLInputElement>(null)
  const settingsToggle = useRef<HTMLButtonElement>(null)
  const settingsPanel = useRef<HTMLDivElement>(null)
  const activeShare = room.shares.find((share) => share.presenter.id === selectedPresenter)
    ?? room.shares.find((share) => share.video) ?? room.shares[0]
  const player = usePlayback(activeShare)

  function end(nextPhase: Phase, message = '') {
    session.current?.close()
    session.current = null
    capture.current?.getTracks().forEach((track) => track.stop())
    capture.current = null
    setRoom(emptyRoom)
    setSelectedPresenter(undefined)
    setLink('')
    setCopy('idle')
    setSettingsOpen(false)
    setCapturePhase('idle')
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
      end(error ? 'error' : 'ended', error || 'O anfitrião encerrou a sala ou se desconectou.')
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

  async function stopCapture(message = '') {
    const current = session.current
    const stream = capture.current
    if (!stream) return
    capture.current = null
    stream.getTracks().forEach((track) => track.stop())
    setCapturePhase('stopping')
    setDetail(message)
    try {
      await current?.stopSharing(stream)
    } catch {
      if (session.current === current) setDetail('A captura parou. Se a prévia continuar visível, atualize a página.')
    } finally {
      if (mounted.current && session.current === current) setCapturePhase('idle')
    }
  }

  async function start() {
    setSettingsOpen(false)
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setDetail('Para compartilhar, abra o app em HTTPS ou localhost em um navegador desktop compatível.')
      return
    }
    const preset = qualities[quality]
    const existing = session.current
    if (viewer && !existing) return
    if (!existing) setPhase('idle')
    setCapturePhase('picking')
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
      if (!mounted.current || session.current !== existing) return
      const canceled = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')
      setCapturePhase('idle')
      setDetail(canceled ? 'Captura cancelada. Você pode escolher uma fonte quando quiser.' : 'Não foi possível capturar a tela. Tente escolher outra fonte.')
      return
    }
    if (!mounted.current || session.current !== existing) {
      selected.getTracks().forEach((track) => track.stop())
      return
    }
    capture.current = selected
    const [video] = selected.getVideoTracks()
    if (!video || video.readyState === 'ended') {
      void stopCapture('A captura foi interrompida. Selecione outra fonte para continuar.')
      return
    }
    video.addEventListener('ended', () => {
      if (capture.current === selected) void stopCapture('A captura foi interrompida no navegador.')
    }, { once: true })
    setCapturePhase('publishing')
    const current = existing || createSession({ role: 'host' }, setRoom, (error) => {
      end(error ? 'error' : 'ended', error)
    })
    session.current = current
    if (!existing) {
      setPhase('connecting')
      try {
        const invite = await current.connect()
        if (session.current !== current || !invite) return
        setLink(invite)
        setPhase('ready')
      } catch (error) {
        if (session.current === current) {
          end('error', error instanceof RoomAccessError ? error.message : 'Não foi possível abrir a sala. Tente novamente.')
        }
        return
      }
    }

    if (capture.current !== selected) return
    try {
      const presenter = await current.startSharing(selected, preset)
      if (capture.current === selected) {
        setSelectedPresenter(presenter)
        setCapturePhase('live')
      }
    } catch {
      if (capture.current === selected) void stopCapture('Não foi possível transmitir esta fonte. Escolha outra fonte para tentar novamente.')
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
  const broadcasting = capturePhase === 'live'
  const busy = phase === 'connecting' || capturePhase === 'picking' || capturePhase === 'publishing' || capturePhase === 'stopping'
  const live = phase === 'ready' && room.shares.some((share) => share.video)
  const captureAvailable = Boolean(navigator.mediaDevices?.getDisplayMedia)
  const canConfigure = captureAvailable && (!viewer || phase === 'ready') && !busy && !broadcasting && !room.reconnecting
  const stageDetail = detail || (!captureAvailable && !viewer
    ? 'Para compartilhar, abra o app em HTTPS ou localhost em um navegador desktop compatível.' : '')
  const status = room.reconnecting ? 'Reconectando' : capturePhase === 'picking' ? 'Escolhendo tela'
    : capturePhase === 'stopping' ? 'Parando' : busy ? 'Conectando' : live ? 'Ao vivo' : phase === 'ready' ? 'Sala aberta'
    : phase === 'ended' ? 'Encerrada' : phase === 'error' ? 'Indisponível' : 'Fora do ar'

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
        <div className="stage-pane">
          <Stage player={player} share={activeShare} reconnecting={room.reconnecting} viewer={viewer} phase={phase} capturePhase={capturePhase} detail={stageDetail} audioRequested={shareAudio} onAudioChange={setShareAudio} onStart={canConfigure ? start : undefined} onRetry={() => setAttempt((value) => value + 1)} />
          {room.shares.length > 1 && <div className="share-picker" role="group" aria-label="Telas compartilhadas">
            <span>Telas ao vivo</span>
            {room.shares.map(({ presenter }) => <button key={presenter.id} className="share-choice" onClick={() => setSelectedPresenter(presenter.id)} aria-pressed={activeShare?.presenter.id === presenter.id}>
              <Monitor size={15} />{presenter.local ? 'Sua tela' : presenter.name}
            </button>)}
          </div>}
        </div>
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
          {activeShare?.video && <CaptureAudio enabled={shareAudio} onChange={setShareAudio} />}
        </div>}
        {link && copy === 'fallback' && <div className="dock-tray invite-fallback">
          <label>Copie o link da sala<input ref={linkInput} readOnly aria-label="Link de convite" value={link} onFocus={(event) => event.currentTarget.select()} /></label>
        </div>}

        <div className="dock" role="group" aria-label="Controles da sala">
          {canConfigure && <button className="dock-button" ref={settingsToggle} aria-controls="share-settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}><SlidersHorizontal size={20} /><span>Ajustes</span></button>}
          {canConfigure && activeShare?.video && <button className="dock-button share-action" aria-label="Compartilhar tela" onClick={start}><MonitorUp size={20} /><span>Compartilhar</span></button>}
          <button className="dock-button" onClick={() => setPeopleOpen(!peopleOpen)} aria-controls="people" aria-expanded={peopleOpen} aria-label="Participantes">
            <Users size={20} /><span>Pessoas <small>{people.length}</small></span>
          </button>
          {link && <button className="dock-button" onClick={copyLink} data-copied={copy === 'copied'} aria-label={copy === 'copied' ? 'Link copiado' : 'Copiar link de convite'}>
            {copy === 'copied' ? <Check size={20} /> : <Link2 size={20} />}<span>{copy === 'copied' ? 'Copiado' : 'Convite'}</span>
          </button>}
          {activeShare?.audio && <button className="dock-button" onClick={player.toggleSound} aria-label={player.sound === 'playing' ? 'Silenciar áudio' : 'Ativar áudio'}>
            {player.sound === 'playing' ? <Volume2 size={20} /> : <VolumeX size={20} />}<span>{player.sound === 'playing' ? 'Som' : 'Ativar som'}</span>
          </button>}
          {activeShare?.video && <button className="dock-button" onClick={player.fullscreen} aria-label="Tela cheia"><Maximize size={20} /><span>Tela cheia</span></button>}
          {viewer && <a className="dock-button dock-leave" href="/" aria-label="Sair da sala" onClick={() => end('ended')}><LogOut size={19} /><span>Sair</span></a>}
          {(broadcasting || capturePhase === 'publishing') && <button className="dock-button stop" aria-label="Parar transmissão" onClick={() => void stopCapture()}><Square size={16} /><span>Parar</span></button>}
          {link && <button className="dock-button dock-leave" onClick={() => end('ended', 'Você encerrou a sala. O convite expirou.')}><LogOut size={19} /><span>Encerrar sala</span></button>}
        </div>
      </footer>
    </main>
  </div>
}

const route = window.location.pathname.match(/^\/s\/([^/]+)\/?$/)
createRoot(document.getElementById('root')!).render(<Workspace viewerId={route?.[1]} />)
