import { useEffect, useRef, useState } from 'react'
import { STATUSES, ago, supabase, type Media, type Status } from './lib'
import { driveFileId } from './drive'

const MEDIA = /^(image\/|video\/(mp4|quicktime|webm)$)/
const isMedia = (f: File) => MEDIA.test(f.type)

/** Who logged a report: Autobot (for someone) or a person on the site. */
export function SourceTag({ report }: { report: { source: string; reported_by: string | null } }) {
  const who = report.reported_by && report.reported_by !== 'Autobot' ? report.reported_by : null
  return report.source === 'autobot' ? (
    <span className="src src-autobot" title={who ? `Logged by Autobot for ${who}` : 'Logged by Autobot'}>
      <span className="src-kind">Autobot</span>
      {who && <span className="src-who">for {who}</span>}
    </span>
  ) : (
    <span className="src src-manual" title={`Logged manually by ${who || 'someone'}`}>
      <span className="src-kind">Manual</span>
      {who && <span className="src-who">{who}</span>}
    </span>
  )
}

export function StatusPill({ status }: { status: Status }) {
  const s = STATUSES[status]
  return <span className={`pill tone-${s.tone}`}>{s.label}</span>
}

export function SeverityTag({ severity }: { severity: string }) {
  return <span className={`sev sev-${severity}`}>{severity}</span>
}

/** Drop, paste (⌘V) or pick screenshots. */
export function ScreenshotPicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const filesRef = useRef(files)
  filesRef.current = files

  const add = (list: FileList | File[] | null) => {
    if (!list) return
    const imgs = Array.from(list).filter(isMedia)
    if (imgs.length) onChange([...filesRef.current, ...imgs])
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.files || [])
      if (items.some(isMedia)) {
        e.preventDefault()
        add(items)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div
        className={`drop ${over ? 'over' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          add(e.dataTransfer.files)
        }}
      >
        <strong>Drop screenshots or recordings here</strong>
        <span>or paste with ⌘V · or click to choose · recordings go to Google Drive</span>
        <input ref={input} type="file" accept="image/*,video/mp4,video/quicktime,video/webm" multiple hidden onChange={(e) => add(e.target.files)} />
      </div>
      {files.length > 0 && (
        <div className="thumbs">
          {files.map((f, i) => (
            <div className="thumb" key={i}>
              {f.type.startsWith('video/') ? <video src={URL.createObjectURL(f)} muted /> : <img src={URL.createObjectURL(f)} alt="" />}
              {f.type.startsWith('video/') && <span className="play">▶</span>}
              <button type="button" aria-label="Remove" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Gallery({ items }: { items: Media[] }) {
  const [open, setOpen] = useState<Media | null>(null)
  if (!items.length) return null
  return (
    <>
      <div className="thumbs">
        {items.map((m) =>
          m.drive ? (
            // Opens in a new tab: browsers like Brave and Safari block Drive's embedded player from seeing your Google sign-in.
            <a
              className="thumb drive"
              key={m.src}
              href={m.src}
              target="_blank"
              rel="noreferrer"
              title="Opens in Google Drive. New uploads can take a few minutes before Drive can play them."
            >
              <span className="drive-tile">
                <span className="play-lg">▶</span>
                <span className="small">Recording</span>
                <span className="drive-open">Opens in Drive ↗</span>
              </span>
            </a>
          ) : (
          <button className="thumb" key={m.src} onClick={() => setOpen(m)} aria-label={m.kind === 'video' ? 'Play recording' : 'Open screenshot'}>
            {m.kind === 'video' ? (
              <video src={m.src} muted preload="metadata" />
            ) : (
              <img src={m.src} alt="Screenshot" />
            )}
            {m.kind === 'video' && <span className="play">▶</span>}
          </button>
          ),
        )}
      </div>
      {open && (
        <div className="lightbox" onClick={(e) => e.target === e.currentTarget && setOpen(null)}>
          {open.kind === 'video' ? (
            <video src={open.src} controls autoPlay />
          ) : (
            <>
              <img src={open.src} alt="Screenshot" onClick={() => setOpen(null)} />
              <a className="lightbox-full" href={open.src} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                Open full size in a new tab ↗
              </a>
            </>
          )}
          <button className="lightbox-close" onClick={() => setOpen(null)} aria-label="Close">×</button>
        </div>
      )}
    </>
  )
}

/** Paste Google Drive links to recordings that are already in Drive. */
export function DriveLinks({ links, onChange }: { links: string[]; onChange: (l: string[]) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  function add() {
    const v = value.trim()
    if (!v) return
    if (!driveFileId(v)) return setError('That doesn’t look like a Google Drive file link.')
    onChange([...links, v])
    setValue('')
    setError('')
  }
  return (
    <div className="drive-links">
      <div className="row">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="Or paste a Google Drive link to a recording"
        />
        <button type="button" className="btn ghost small" onClick={add}>Add</button>
      </div>
      {error && <p className="error small">{error}</p>}
      {links.map((l) => (
        <div className="drive-link" key={l}>
          <span>▶ Drive recording</span>
          <a href={l} target="_blank" rel="noreferrer" className="small">{l.slice(0, 48)}…</a>
          <button type="button" aria-label="Remove" onClick={() => onChange(links.filter((x) => x !== l))}>×</button>
        </div>
      ))}
    </div>
  )
}

/** Convogenie logomark: always black; CSS flips it to white only on the dark theme. */
export function Logo({ size }: { size: number }) {
  return <img className="logo" src="/logomark.svg" alt="Convogenie" width={size} height={size} style={{ display: 'block' }} />
}

/** Password box with a show/hide eye button. */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false)
  return (
    <span className="pw-field">
      <input {...props} type={show ? 'text' : 'password'} />
      <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
        {show ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18" /><path d="M10.6 5.1A10.5 10.5 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.4 8 2.8 10.2 2 12c1 2.5 5 7 10 7 1.9 0 3.6-.6 5.1-1.5" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
        )}
      </button>
    </span>
  )
}

/** Avatar that opens a small menu. Signing out is a deliberate second click. */
export function UserMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false)
  const [setting, setSetting] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="avatar" aria-label="Account" aria-expanded={open} onClick={() => setOpen(!open)}>
        {name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="menu card">
          <strong>{name}</strong>
          <span className="muted small">{email}</span>
          <hr />
          <a className="menu-item" href="#/settings" onClick={() => setOpen(false)}>Settings</a>
          {setting ? (
            <PasswordForm email={email} onDone={() => setSetting(false)} />
          ) : (
            <button className="menu-item" onClick={() => setSetting(true)}>Set password</button>
          )}
          <hr />
          <button className="menu-item" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      )}
    </div>
  )
}

function PasswordForm({ email, onDone }: { email: string; onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return setMsg({ ok: false, text: 'Use at least 8 characters.' })
    if (pw !== pw2) return setMsg({ ok: false, text: 'The two passwords don’t match.' })
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) setMsg({ ok: false, text: error.message })
    else {
      setMsg({ ok: true, text: 'Password saved. Next time, sign in with it. No email needed.' })
      setPw('')
      setPw2('')
      setTimeout(onDone, 2500)
    }
  }

  return (
    <form className="pw-form" onSubmit={save}>
      {/* Hidden username so password managers save the right account */}
      <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
      <PasswordInput autoComplete="new-password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      <PasswordInput autoComplete="new-password" placeholder="Type it again" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'error'}`}>{msg.text}</p>}
      <div className="row end">
        <button type="button" className="btn ghost small" onClick={onDone}>Cancel</button>
        <button className="btn primary small" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}

/** Bell with a count; opens a list of notifications. */
export function NotificationBell({
  notices,
  onMarkAll,
}: {
  notices: import('./notifications').Notice[]
  onMarkAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const n = notices.length
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`bell ${n ? 'has' : ''}`} aria-label={n ? `${n} new notifications` : 'Notifications'} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {n > 0 && <span className="bell-count">{n > 99 ? '99+' : n}</span>}
      </button>
      {open && (
        <div className="menu card notif-menu">
          <div className="row between notif-head">
            <strong>Notifications</strong>
            {n > 0 && (
              <button className="link-btn small" onClick={onMarkAll}>Mark all as read</button>
            )}
          </div>
          {n === 0 ? (
            <p className="muted small notif-empty">You’re all caught up.</p>
          ) : (
            <ul className="notif-list">
              {notices.slice(0, 30).map((x) => (
                <li key={x.key}>
                  <a href={`#/r/${x.number}`} onClick={() => setOpen(false)} className={x.action ? 'needs-action' : ''}>
                    <span className="dot-new" />
                    <span className="grow">
                      <span className="notif-text">{x.text}</span>
                      <span className="muted small block notif-title">#{x.number} {x.title}</span>
                      <span className="muted small">
                        {ago(x.when)}
                        {x.more > 0 && ` · +${x.more} more`}
                      </span>
                    </span>
                    {x.action && <span className="notif-action">{x.action}</span>}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
