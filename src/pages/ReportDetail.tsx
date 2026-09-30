import { useCallback, useEffect, useState } from 'react'
import { DriveLinks, Gallery, ScreenshotPicker, SeverityTag, SourceTag, StatusPill } from '../components'
import {
  CATEGORIES,
  STATUSES,
  ago,
  markSeen,
  toMedia,
  useLive,
  useDriveReady,
  supabase,
  uploadMedia,
  type Media,
  type Attachment,
  type Event,
  type Me,
  type Report,
  type Status,
  type Verdict,
} from '../lib'

type Action = 'comment' | 'fix' | 'retest' | 'status' | 'update' | 'close'

const isFixer = (me: Me) => me.role === 'fixer'

function suggestedAction(me: Me, status: Status): Action {
  if (isFixer(me)) return ['open', 'acknowledged', 'reopened'].includes(status) ? 'fix' : 'comment'
  return status === 'fixed' ? 'retest' : 'update'
}

/** Did this person file the report (directly, or through Autobot for them)? */
const isMine = (me: Me, r: Report) =>
  r.reporter_email ? r.reporter_email.toLowerCase() === me.email.toLowerCase() : r.reported_by === me.name
const REOPENABLE: Status[] = ['closed', 'verified', 'wont_fix']

export default function ReportDetail({ number, me }: { number: number; me: Me }) {
  const [report, setReport] = useState<Report | null | undefined>(undefined)
  const [events, setEvents] = useState<Event[]>([])
  const [shots, setShots] = useState<(Attachment & { media: Media })[]>([])
  const [action, setAction] = useState<Action | null>(null)

  const load = useCallback(async () => {
    const { data: r } = await supabase.from('reports').select('*').eq('number', number).maybeSingle()
    setReport(r as Report | null)
    if (!r) return
    const [{ data: ev }, { data: at }] = await Promise.all([
      supabase.from('events').select('*').eq('report_id', r.id).order('created_at'),
      supabase.from('attachments').select('*').eq('report_id', r.id).order('created_at'),
    ])
    setEvents((ev as Event[]) || [])
    markSeen(me, r.id)
    const atts = (at as Attachment[]) || []
    setShots(await toMedia(atts))
  }, [number, me])

  useEffect(() => {
    load()
  }, [load])

  // Replies, fixes, retests and attachments on this report appear as they happen
  const rid = report?.id
  useLive(
    rid
      ? [
          { table: 'events', filter: `report_id=eq.${rid}` },
          { table: 'attachments', filter: `report_id=eq.${rid}` },
          { table: 'reports', filter: `id=eq.${rid}` },
        ]
      : [],
    load,
  )

  if (report === undefined) return <p className="muted pad">Loading…</p>
  if (report === null)
    return (
      <div className="card empty">
        <p>Report #{number} not found.</p>
        <a className="btn ghost" href="#/">Back to reports</a>
      </div>
    )

  function focusPanel(a: Action) {
    setAction(a)
    setTimeout(() => {
      const panel = document.querySelector('.panel')
      panel?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      ;(panel?.querySelector('textarea, select') as HTMLElement | null)?.focus({ preventScroll: true })
    }, 50)
  }

  const retests = events.filter((e) => e.kind === 'retest')
  const latest = retests[retests.length - 1]
  const shotsFor = (eventId: string | null) => shots.filter((s) => s.event_id === eventId).map((s) => s.media)

  return (
    <div className="detail">
      <div className="stack">
        <a className="back" href="#/">← All reports</a>
        <header className="card">
          <div className="row wrap gap-s">
            <span className="num big">#{report.number}</span>
            <StatusPill status={report.status} />
            <StageButton report={report} me={me} onPick={focusPanel} />
            <SeverityTag severity={report.severity} />
            <span className="chip">{CATEGORIES[report.category]?.label || report.category}</span>
            <SourceTag report={report} />
          </div>
          <div className="row between title-row">
            <h1>{report.title}</h1>
            {!isFixer(me) && (
              <button
                className="btn ghost small"
                onClick={() => focusPanel('update')}
              >
                ✎ Add update
              </button>
            )}
          </div>
          <p className="muted small">
            Reported by {report.reported_by || 'someone'}{report.source === 'autobot' && report.reported_by !== 'Autobot' ? ' via Autobot' : ''} · {ago(report.created_at)}
            {report.conversation_url && (
              <> · <a href={report.conversation_url} target="_blank" rel="noreferrer">conversation ↗</a></>
            )}
          </p>
        </header>

        <section className="card">
          <div className="expect-vs">
            <div className="expect">
              <span className="label">What was expected</span>
              <p>{report.expected_behavior || <span className="muted">Not written yet.</span>}</p>
            </div>
            <div className="wrong">
              <span className="label">What went wrong</span>
              <p>
                {report.summary || (
                  <span className="muted">
                    {isFixer(me) ? 'Not written yet. Check “Exact prompt & reply” below, or ask with “Reply”.' : 'Not written yet. Add it with “Add update”.'}
                  </span>
                )}
              </p>
            </div>
          </div>
          <Gallery items={shotsFor(null)} />
          {report.notes && <Block label="Notes" text={report.notes} />}

          <details className="exact">
            <summary>Exact prompt & reply</summary>
            <div className="exact-body">
              <div className="row between">
                <span className="label">Prompt sent to Autobot</span>
                <button type="button" className="btn ghost small" onClick={() => navigator.clipboard.writeText(report.prompt)}>Copy</button>
              </div>
              <pre className="reply">{report.prompt}</pre>
              <span className="label">Autobot's reply</span>
              {report.actual_response ? <pre className="reply">{report.actual_response}</pre> : <p className="muted small">Not provided.</p>}
            </div>
          </details>
        </section>

        {latest && (
          <section className={`card verdict-${latest.verdict}`}>
            <span className="label">
              Latest retest {retests.length > 1 ? `(#${retests.length}) ` : ''}
              <VerdictTag v={latest.verdict!} />
            </span>
            {latest.body && <p className="prewrap">{latest.body}</p>}
            <Gallery items={shotsFor(latest.id)} />
            {latest.response_text && (
              <details className="exact">
                <summary>Autobot's reply this time</summary>
                <pre className="reply">{latest.response_text}</pre>
              </details>
            )}
          </section>
        )}

        <section className="card">
          <h2>Timeline</h2>
          <ol className="timeline">
            <li>
              <span className="tl-dot" />
              <div>
                <strong>Reported</strong> <span className="muted small">{ago(report.created_at)}</span>
              </div>
            </li>
            {events.map((e) => (
              <TimelineItem key={e.id} e={e} isLatest={e.id === latest?.id} shots={e.id === latest?.id ? [] : shotsFor(e.id)} />
            ))}
          </ol>
        </section>
      </div>

      <aside>
        <ActionPanel report={report} me={me} action={action ?? suggestedAction(me, report.status)} setAction={setAction} onDone={load} />
      </aside>
    </div>
  )
}

/** The obvious "move this report" button next to the stage badge. */
function StageButton({ report, me, onPick }: { report: Report; me: Me; onPick: (a: Action) => void }) {
  if (isFixer(me))
    return (
      <span className="stage-btns">
        {['open', 'acknowledged', 'reopened'].includes(report.status) && (
          <button className="btn primary small" onClick={() => onPick('fix')}>Mark fixed</button>
        )}
        <button className="btn ghost small" onClick={() => onPick('status')}>Change stage ▾</button>
      </span>
    )
  const mine = isMine(me, report)
  return (
    <span className="stage-btns">
      {report.status === 'fixed' && (
        <button className="btn primary small" onClick={() => onPick('retest')}>Retest now</button>
      )}
      {mine && (
        <button className="btn ghost small" onClick={() => onPick('close')}>
          {REOPENABLE.includes(report.status) ? 'Reopen' : 'Close report'}
        </button>
      )}
    </span>
  )
}

function Block({ label, text, mono, highlight, lead }: { label: string; text: string; mono?: boolean; highlight?: boolean; lead?: boolean }) {
  return (
    <div className={`block ${highlight ? 'highlight' : ''} ${lead ? 'lead' : ''}`}>
      <span className="label">{label}</span>
      {mono ? <pre className="reply">{text}</pre> : <p className="prewrap">{text}</p>}
    </div>
  )
}

function VerdictTag({ v }: { v: Verdict }) {
  const label = { pass: 'Passed', partial: 'Partly better', fail: 'Still broken' }[v]
  return <span className={`vtag v-${v}`}>{label}</span>
}

function TimelineItem({ e, shots, isLatest }: { e: Event; shots: Media[]; isLatest: boolean }) {
  const head = {
    comment: 'replied',
    update: 'added an update',
    fix: 'shipped a fix',
    retest: 'retested',
    status: 'moved the stage',
  }[e.kind]
  return (
    <li className={`tl-${e.kind}`}>
      <span className="tl-dot" />
      <div className="grow">
        <div>
          <strong>{e.author || 'Someone'}</strong> {head}
          {e.verdict && <> · <VerdictTag v={e.verdict} /></>}
          {e.to_status && e.from_status !== e.to_status && (
            <> · <span className="muted">{STATUSES[e.from_status!]?.label} → {STATUSES[e.to_status]?.label}</span></>
          )}
          <span className="muted small"> · {ago(e.created_at)}</span>
        </div>
        {e.build && <span className="chip small">{e.build}</span>}
        {e.body && <p className="prewrap">{e.body}</p>}
        {e.kind === 'retest' && e.response_text && !isLatest && (
          <details>
            <summary>Reply from this retest</summary>
            <pre className="reply">{e.response_text}</pre>
          </details>
        )}
        <Gallery items={shots} />
      </div>
    </li>
  )
}

function ActionPanel({
  report,
  me,
  action,
  setAction,
  onDone,
}: {
  report: Report
  me: Me
  action: Action
  setAction: (a: Action) => void
  onDone: () => void
}) {
  const [body, setBody] = useState('')
  const [reply, setReply] = useState('')
  const [build, setBuild] = useState('')
  const [verdict, setVerdict] = useState<Verdict>('pass')
  const [status, setStatus] = useState<Status>('acknowledged')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [upStatus, setUpStatus] = useState('')
  const [links, setLinks] = useState<string[]>([])
  const driveReady = useDriveReady()
  const [error, setError] = useState('')

  const tabs: [Action, string][] = isFixer(me)
    ? [
        ['fix', 'Mark fixed'],
        ['status', 'Change stage'],
        ['comment', 'Reply'],
      ]
    : [
        ['update', 'Add update'],
        ...(report.status === 'fixed' ? ([['retest', 'Retest']] as [Action, string][]) : []),
        ...(isMine(me, report) && (report.status !== 'closed' || REOPENABLE.includes(report.status))
          ? ([['close', report.status === 'closed' || REOPENABLE.includes(report.status) ? 'Reopen' : 'Close']] as [Action, string][])
          : []),
      ]
  const current: Action = tabs.some(([k]) => k === action) ? action : tabs[0][0]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (current === 'update' && !body.trim() && !files.length && !links.length) return setError('Add some text, a screenshot or a recording.')
    setBusy(true)
    setError('')
    const row: Partial<Event> & { report_id: string } = { report_id: report.id, kind: current === 'close' ? 'status' : current, author: me.name, body: body || null }
    if (current === 'fix') row.build = build || null
    if (current === 'retest') Object.assign(row, { verdict, response_text: reply || null, build: build || null })
    if (current === 'status') row.to_status = status
    if (current === 'close') {
      if (!body.trim()) {
        setBusy(false)
        return setError('Please add a short reason.')
      }
      row.kind = 'status'
      row.to_status = REOPENABLE.includes(report.status) ? 'reopened' : 'closed'
    }
    const { data, error } = await supabase.from('events').insert(row).select().single()
    let uploadError = ''
    if (!error && (files.length || links.length)) {
      try {
        await uploadMedia(files, links, { reportId: report.id, reportNumber: report.number, eventId: (data as Event).id, me, onStatus: setUpStatus })
      } catch (err) {
        uploadError = (err as Error).message
      }
    }
    if (error) setError(error.message)
    else if (uploadError) {
      setError(`Saved, but an attachment didn’t upload: ${uploadError}`)
      onDone()
    } else {
      setBody('')
      setReply('')
      setBuild('')
      setFiles([])
      setLinks([])
      setAction(suggestedAction(me, report.status))
      onDone()
    }
    setBusy(false)
  }

  return (
    <form className="card panel" onSubmit={submit}>
      {tabs.length > 1 && (
        <div className="tabs small">
          {tabs.map(([k, l]) => (
            <button type="button" key={k} className={current === k ? 'on' : ''} onClick={() => setAction(k)}>
              {l}
            </button>
          ))}
        </div>
      )}

      {current === 'update' && (
        <>
          <h2 className="panel-title">Add an update</h2>
          <p className="muted small">
            Add more detail or proof. The original report stays exactly as it was; this is added to the timeline, and Rahul sees it as new.
          </p>
          {report.status !== 'fixed' && (
            <p className="stage-note small">
              Stage: <strong>{STATUSES[report.status].label}</strong>. Rahul moves it along. You'll be able to retest once he marks it fixed.
            </p>
          )}
        </>
      )}

      {current === 'retest' && (
        <>
          <p className="muted small">Send the <strong>same prompt</strong> to Autobot again and record what happened.</p>
          <button type="button" className="btn ghost small" onClick={() => navigator.clipboard.writeText(report.prompt)}>
            Copy original prompt
          </button>
          <label>
            New reply
            <textarea rows={5} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Paste Autobot's reply this time" />
          </label>
          <div>
            <span className="label">Did Autobot do what was expected this time?</span>
            <div className="seg-control">
              {(['pass', 'partial', 'fail'] as Verdict[]).map((v) => (
                <button type="button" key={v} className={`v-${v} ${verdict === v ? 'on' : ''}`} onClick={() => setVerdict(v)}>
                  {{ pass: 'Pass', partial: 'Partly', fail: 'Fail' }[v]}
                </button>
              ))}
            </div>
          </div>
          <label>
            Build / version tested
            <input value={build} onChange={(e) => setBuild(e.target.value)} placeholder="e.g. prompt v14, 2 Oct" />
          </label>
        </>
      )}

      {current === 'close' && (
        <>
          <h2 className="panel-title">{REOPENABLE.includes(report.status) ? 'Reopen this report' : 'Close this report'}</h2>
          <p className="muted small">
            {REOPENABLE.includes(report.status)
              ? 'Use this if the problem is happening again or wasn’t really solved. Rahul will be notified.'
              : 'Use this if it sorted itself out or isn’t needed any more. It moves to “Closed · no fix needed” and Rahul is notified. You can reopen it later.'}
          </p>
        </>
      )}

      {current === 'fix' && (
        <>
          <p className="muted small">Moves it to <strong>Needs retest</strong>. It only counts as fixed once the reporter's retest passes.</p>
          <label>
            Version / change
            <input value={build} onChange={(e) => setBuild(e.target.value)} placeholder="e.g. system prompt v14" />
          </label>
        </>
      )}

      {current === 'status' && (
        <label>
          Move to stage
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {Object.entries(STATUSES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
      )}

      <label>
        {{ fix: 'What changed?', retest: 'Notes', status: 'Reason', comment: 'Reply', update: 'What’s new?', close: 'Reason' }[current]}
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required={current === 'comment' || current === 'close'}
          placeholder={
            current === 'update'
              ? 'e.g. It happened again today, screenshot attached.'
              : current === 'close'
                ? REOPENABLE.includes(report.status)
                  ? 'e.g. It happened again today.'
                  : 'e.g. Autobot gets this right now; no fix needed.'
                : undefined
          }
        />
      </label>

      {(current === 'retest' || current === 'update' || current === 'comment') && (
        <div>
          <ScreenshotPicker files={files} onChange={setFiles} />
          <DriveLinks links={links} onChange={setLinks} />
          {driveReady === false && files.some((x) => x.type.startsWith('video/')) && (
            <p className="warn small">Recordings go to Google Drive, which an admin still needs to set up in Settings. For now, paste a Drive link instead.</p>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <button className="btn primary wide" disabled={busy}>
        {busy
          ? upStatus || 'Saving…'
          : { retest: 'Save retest', fix: 'Mark as fixed', comment: 'Post reply', status: 'Move stage', update: 'Add update', close: REOPENABLE.includes(report.status) ? 'Reopen report' : 'Close report' }[current]}
      </button>
    </form>
  )
}
