import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { openSession, qualities, type Status } from './session'
import './style.css'

const idle: Status = { label: 'Pronto para compartilhar' }
const connecting: Status = { label: 'Conectando ao servidor', tone: 'pending' }

function Monitor({ small = false }: { small?: boolean }) {
  return <span className={small ? 'monitor small' : 'monitor'} aria-hidden="true"><i /></span>
}

function StatusBadge({ status }: { status: Status }) {
  return <span className="status" data-tone={status.tone}><i />{status.label}</span>
}

function VideoStage({ stream, viewer = false }: { stream: MediaStream | null; viewer?: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const [needsPlay, setNeedsPlay] = useState(false)
  const [videoError, setVideoError] = useState('')

  useEffect(() => {
    const element = video.current
    if (!element) return
    let current = true
    element.srcObject = stream
    setNeedsPlay(false)
    setVideoError('')
    if (stream) element.play().catch(() => { if (current) setNeedsPlay(true) })
    return () => {
      current = false
      element.srcObject = null
    }
  }, [stream])

  async function play() {
    try {
      await video.current?.play()
      setNeedsPlay(false)
      setVideoError('')
    } catch {
      setVideoError('O navegador não conseguiu reproduzir o vídeo.')
    }
  }

  async function fullscreen() {
    try {
      if (!video.current?.requestFullscreen) throw new Error()
      await video.current.requestFullscreen()
    } catch {
      setVideoError('Tela cheia indisponível neste navegador.')
    }
  }

  return <section className="stage" aria-label={viewer ? 'Vídeo compartilhado' : 'Prévia da tela'}>
    <div className="stage-bar">
      <span><Monitor small />{viewer ? 'Vídeo' : 'Prévia'}</span>
      {viewer
        ? <button className="button compact" onClick={fullscreen} disabled={!stream}>Tela cheia</button>
        : <span className="stage-note">Somente vídeo</span>}
    </div>
    <div className="canvas">
      <video ref={video} hidden={!stream} autoPlay playsInline muted={!viewer} />
      {!stream && <div className="empty">
        <Monitor />
        <p>{viewer ? 'Aguardando vídeo' : 'Sua tela aparece aqui'}</p>
        {!viewer && <span>Escolha uma tela, janela ou aba para começar.</span>}
      </div>}
      {stream && needsPlay && <button className="button primary play" onClick={play}>Reproduzir vídeo</button>}
    </div>
    {videoError && <p className="stage-error" role="alert">{videoError}</p>}
  </section>
}

function Host() {
  const [qualityKey, setQualityKey] = useState<keyof typeof qualities>('standard')
  const [status, setStatus] = useState(idle)
  const [busy, setBusy] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [link, setLink] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const linkField = useRef<HTMLInputElement>(null)
  const capture = useRef<MediaStream | null>(null)
  const session = useRef<ReturnType<typeof openSession> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      session.current?.close()
      capture.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  function end(status: Status) {
    session.current?.stop()
    session.current = null
    capture.current?.getTracks().forEach((track) => track.stop())
    capture.current = null
    setStream(null)
    setLink('')
    setCopyStatus('')
    setBusy(false)
    setStatus(status)
  }

  async function start() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus({ label: 'Captura indisponível', tone: 'error',
        detail: 'Abra o aplicativo em localhost ou HTTPS com um navegador que permita compartilhar a tela.' })
      return
    }
    const quality = qualities[qualityKey]
    setBusy(true)
    setStatus({ label: 'Escolhendo a fonte', tone: 'pending' })
    try {
      const selected = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          width: { ideal: quality.width, max: quality.width },
          height: { ideal: quality.height, max: quality.height },
          frameRate: { ideal: quality.fps, max: quality.fps },
        },
      })
      if (!mounted.current) {
        selected.getTracks().forEach((track) => track.stop())
        return
      }
      capture.current = selected
      const [track] = selected.getVideoTracks()
      if (!track || track.readyState === 'ended') {
        end({ label: 'Captura interrompida', tone: 'error' })
        return
      }
      track.addEventListener('ended', () => {
        if (capture.current === selected) end({ label: 'Transmissão encerrada' })
      }, { once: true })
      setStream(selected)
      setStatus(connecting)
      session.current = openSession({
        role: 'host',
        stream: selected,
        quality,
        onRoom: (id, viewerOrigin) => {
          const { hostname, origin } = window.location
          const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
          setLink(new URL(`/s/${id}`, (local && viewerOrigin) || origin).href)
        },
      }, setStatus, end)
      setBusy(false)
    } catch (error) {
      if (!mounted.current) return
      const canceled = error instanceof DOMException && error.name === 'NotAllowedError'
      end(canceled
        ? { label: 'Captura cancelada', detail: 'Selecione uma fonte no navegador para começar.' }
        : { label: 'Falha na captura', tone: 'error', detail: 'Tente compartilhar outra tela, janela ou aba.' })
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopyStatus('Link copiado.')
    } catch {
      linkField.current?.focus()
      linkField.current?.select()
      setCopyStatus('Pressione Ctrl+C para copiar o link selecionado.')
    }
  }

  return <>
    <div className="heading">
      <div><h1>Compartilhe sua tela</h1><p>Envie um link para um amigo assistir pelo navegador.</p></div>
      <StatusBadge status={status} />
    </div>
    <div className="layout">
      <VideoStage stream={stream} />
      <aside className="panel" aria-label="Controles da transmissão">
        <fieldset disabled={busy || Boolean(stream)}>
          <legend>Qualidade do vídeo</legend>
          {Object.entries(qualities).map(([key, quality]) =>
            <label className="choice" key={key}>
              <input type="radio" name="quality" value={key} checked={key === qualityKey}
                onChange={() => setQualityKey(key as keyof typeof qualities)} />
              {quality.label}
            </label>)}
          <p className="hint">A qualidade real depende da fonte e da conexão.</p>
        </fieldset>
        {stream
          ? <button className="button stop" onClick={() => end({ label: 'Transmissão encerrada' })}>Parar transmissão</button>
          : <button className="button primary" disabled={busy} onClick={start}>Compartilhar tela</button>}
        {link && <div className="share">
          <label htmlFor="invite">Link do espectador</label>
          <input ref={linkField} id="invite" readOnly value={link} />
          <button className="button" onClick={copyLink}>Copiar link</button>
          <p className="hint" aria-live="polite">{copyStatus || 'O link dá acesso a um espectador por vez.'}</p>
        </div>}
        {status.detail && <p className="feedback" role={status.tone === 'error' ? 'alert' : 'status'}>{status.detail}</p>}
      </aside>
    </div>
  </>
}

function Viewer({ id }: { id: string }) {
  const [status, setStatus] = useState(connecting)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setStatus(connecting)
    const session = openSession({ role: 'viewer', id, onStream: setStream }, setStatus, setStatus)
    return session.close
  }, [id, attempt])

  return <>
    <div className="heading">
      <h1>Tela compartilhada</h1>
      <StatusBadge status={status} />
    </div>
    <VideoStage stream={stream} viewer />
    {status.detail && <div className="feedback viewer-feedback" role="alert">
      <p>{status.detail}</p>
      <button className="button" onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</button>
    </div>}
  </>
}

const viewer = window.location.pathname.match(/^\/s\/([^/]+)\/?$/)
createRoot(document.getElementById('root')!).render(
  <main className="app">
    <header className="brand"><a href="/" aria-label="ScreenShare, página inicial"><Monitor small />ScreenShare</a></header>
    {viewer ? <Viewer id={viewer[1]} /> : <Host />}
  </main>,
)
