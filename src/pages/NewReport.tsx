import { useRef, useState } from 'react'
import { DriveLinks, ScreenshotPicker } from '../components'
import { CATEGORIES, SEVERITIES, go, supabase, uploadMedia, useDriveReady, type Me, type Report } from '../lib'

export default function NewReport({ me }: { me: Me }) {
  const [f, setF] = useState({
    title: '',
    expected_behavior: '',
    summary: '',
    category: 'instructions',
    severity: 'medium',
    prompt: '',
    actual_response: '',
    notes: '',
    conversation_url: '',
  })
  const [files, setFiles] = useState<File[]>([])
  const [links, setLinks] = useState<string[]>([])
  const driveReady = useDriveReady()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const exactRef = useRef<HTMLDetailsElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!f.prompt.trim()) {
      exactRef.current!.open = true
      promptRef.current?.focus()
      return setError('Add the exact prompt that was sent to Autobot. It’s needed to try the same thing again after the fix.')
    }
    setBusy(true)
    setError('')
    const { data, error } = await supabase
      .from('reports')
      .insert({ ...f, notes: f.notes || null, conversation_url: f.conversation_url || null, reported_by: me.name })
      .select()
      .single()
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }
    const report = data as Report
    try {
      await uploadMedia(files, links, { reportId: report.id, reportNumber: report.number, eventId: null, me, onStatus: setStatus })
    } catch (err) {
      setError(`Report #${report.number} was saved, but an attachment didn’t upload: ${(err as Error).message} You can add it from the report page with “Add update”.`)
      setBusy(false)
      return
    }
    go(`/r/${report.number}`)
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h1>Report an issue</h1>
      <p className="muted">
        Describe what Autobot should have done and what it did instead, so it can be fixed. Keep the exact prompt too, so the same thing can be tried again after the fix.
      </p>
      <p className="tip">
        <strong>Tip:</strong> while chatting with Autobot, just say <strong>“log this as feedback”</strong>. It fills this form in for you. Add screenshots here afterwards.
      </p>

      <label>
        Short title
        <input required value={f.title} onChange={set('title')} placeholder="e.g. Switched to English after being told to reply in Hindi" />
      </label>

      <label>
        What was expected?
        <textarea
          required
          rows={2}
          value={f.expected_behavior}
          onChange={set('expected_behavior')}
          placeholder="What Autobot should have done, e.g. “Autobot should have kept replying in Hindi, including drafts.”"
        />
      </label>

      <label>
        What went wrong?
        <textarea
          required
          rows={4}
          value={f.summary}
          onChange={set('summary')}
          placeholder="What Autobot did instead, e.g. “Autobot was asked to reply only in Hindi. Four messages later it drafted the Diwali offer in English, without being told to switch.”"
        />
      </label>

      <div className="grid2">
        <label>
          What kind of problem?
          <select value={f.category} onChange={set('category')}>
            {Object.entries(CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <small>{CATEGORIES[f.category].hint}</small>
        </label>
        <label>
          How bad?
          <select value={f.severity} onChange={set('severity')}>
            {Object.entries(SEVERITIES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <small>Critical = wrong action on a real app or customer-facing mistake</small>
        </label>
      </div>

      <details className="exact" ref={exactRef}>
        <summary>Exact prompt & reply <small>(paste word for word; used when retesting)</small></summary>
        <label>
          Exact prompt sent to Autobot
          <textarea ref={promptRef} rows={4} value={f.prompt} onChange={set('prompt')} placeholder="The request that went wrong, word for word." />
        </label>
        <label>
          Autobot's exact reply
          <textarea rows={4} value={f.actual_response} onChange={set('actual_response')} placeholder="Its reply at the time, word for word." />
        </label>
      </details>

      <div>
        <span className="label">Screenshots & recordings</span>
        <ScreenshotPicker files={files} onChange={setFiles} />
        <DriveLinks links={links} onChange={setLinks} />
        {driveReady === false && files.some((x) => x.type.startsWith('video/')) && (
          <p className="warn small">Recordings go to Google Drive, which an admin still needs to set up in Settings. For now, paste a Drive link instead.</p>
        )}
      </div>

      <details>
        <summary>More details (optional)</summary>
        <label>
          Conversation link
          <input type="url" value={f.conversation_url} onChange={set('conversation_url')} placeholder="https://…" />
        </label>
        <label>
          Notes for the fixer
          <textarea rows={3} value={f.notes} onChange={set('notes')} placeholder="How often it happens, your guess at the cause, related reports…" />
        </label>
      </details>

      {error && <p className="error">{error}</p>}
      <div className="row end">
        <a className="btn ghost" href="#/">Cancel</a>
        <button className="btn primary" disabled={busy}>{busy ? status || 'Saving…' : 'Submit report'}</button>
      </div>
    </form>
  )
}
