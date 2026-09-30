import { useCallback, useEffect, useMemo, useState } from 'react'
import { SourceTag, StatusPill, SeverityTag } from '../components'
import { CATEGORIES, OPEN_STATUSES, ago, download, supabase, useLive, type Me, type Report, type Status, type Verdict } from '../lib'

type Activity = { report_id: string; kind: string; verdict: Verdict | null; created_at: string; author: string | null; author_email: string | null }
type Retest = Activity & { verdict: Verdict }
type Unread = { report: Report; what: string; when: string }

const ACTIVITY_LABEL: Record<string, string> = {
  update: 'added an update',
  comment: 'replied',
  fix: 'marked it fixed',
  retest: 'retested it',
  status: 'moved it to a new stage',
}

const TABS: { key: string; label: string; match: (s: Status) => boolean }[] = [
  { key: 'open', label: 'Open', match: (s) => OPEN_STATUSES.includes(s) },
  { key: 'fixed', label: 'Needs retest', match: (s) => s === 'fixed' },
  { key: 'verified', label: 'Verified', match: (s) => s === 'verified' },
  { key: 'all', label: 'All', match: () => true },
]
const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase())

export default function Reports({ unreadIds }: { me: Me; unreadIds: Set<string> }) {
  const [reports, setReports] = useState<Report[] | null>(null)
  const [activity, setActivity] = useState<Activity[]>([])
  const [tab, setTab] = useState('open')
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')

  const load = useCallback(() => {
    supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setReports((data as Report[]) || []))
    supabase
      .from('events')
      .select('report_id, kind, verdict, created_at, author, author_email')
      .order('created_at')
      .then(({ data }) => setActivity((data as Activity[]) || []))
  }, [])
  useEffect(load, [load])
  // New reports, stage changes and retests show up without refreshing
  useLive([{ table: 'reports' }, { table: 'events' }], load)

  const retests = useMemo(() => activity.filter((a): a is Retest => a.kind === 'retest' && Boolean(a.verdict)), [activity])


  const stats = useMemo(() => {
    const r = reports || []
    const firstVerdict = new Map<string, Verdict>()
    retests.forEach((t) => !firstVerdict.has(t.report_id) && firstVerdict.set(t.report_id, t.verdict))
    const firstTry = [...firstVerdict.values()]
    const passes = retests.filter((t) => t.verdict === 'pass').length
    return {
      open: r.filter((x) => OPEN_STATUSES.includes(x.status)).length,
      fixed: r.filter((x) => x.status === 'fixed').length,
      verified: r.filter((x) => x.status === 'verified').length,
      total: r.length,
      passRate: retests.length ? Math.round((passes / retests.length) * 100) : null,
      firstTry: firstTry.length ? Math.round((firstTry.filter((v) => v === 'pass').length / firstTry.length) * 100) : null,
      retests: retests.length,
    }
  }, [reports, retests])

  const byCategory = useMemo(() => {
    const m = new Map<string, { open: number; fixed: number; verified: number; total: number }>()
    ;(reports || []).forEach((r) => {
      if (r.status === 'wont_fix' || r.status === 'closed') return
      const c = m.get(r.category) || { open: 0, fixed: 0, verified: 0, total: 0 }
      c.total++
      if (r.status === 'verified') c.verified++
      else if (r.status === 'fixed') c.fixed++
      else c.open++
      m.set(r.category, c)
    })
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [reports])

  const max = Math.max(1, ...byCategory.map(([, c]) => c.total))
  const activeTab = TABS.find((t) => t.key === tab)
  const list = (reports || []).filter(
    (r) =>
      (tab === 'new' ? unreadIds.has(r.id) : activeTab!.match(r.status)) &&
      (!category || r.category === category) &&
      (!source || r.source === source) &&
      (!q || `${r.title} ${r.summary || ''} ${r.prompt} #${r.number}`.toLowerCase().includes(q.toLowerCase())),
  )

  function exportTests() {
    const tests = (reports || []).map((r) => ({
      id: r.number,
      title: r.title,
      category: r.category,
      severity: r.severity,
      status: r.status,
      prompt: r.prompt,
      expected: r.expected_behavior,
      original_response: r.actual_response,
    }))
    download(`autobot-test-cases-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(tests, null, 2), 'application/json')
  }

  if (!reports) return <p className="muted pad">Loading…</p>

  return (
    <div className="stack">
      <section className="stats">
        <Stat label="Open" value={stats.open} tone="coral" onClick={() => setTab('open')} />
        <Stat label="Needs retest" value={stats.fixed} tone="blue" onClick={() => setTab('fixed')} />
        <Stat label="Verified fixed" value={stats.verified} tone="teal" onClick={() => setTab('verified')} />
        <Stat
          label="Fixed on first try"
          value={stats.firstTry === null ? '—' : `${stats.firstTry}%`}
          sub={stats.retests ? `${stats.retests} retests · ${stats.passRate}% passed` : 'No retests yet'}
        />
      </section>

      {byCategory.length > 0 && (
        <section className="card">
          <div className="row between">
            <h2>Where Autobot struggles</h2>
            <div className="legend">
              <span><i className="dot coral" />Open</span>
              <span><i className="dot blue" />Needs retest</span>
              <span><i className="dot teal" />Verified</span>
            </div>
          </div>
          <div className="bars">
            {byCategory.map(([cat, c]) => (
              <button key={cat} className="bar-row" onClick={() => { setCategory(cat); setTab('all') }}>
                <span className="bar-label">{CATEGORIES[cat]?.label || cat}</span>
                <span className="bar-track">
                  <span className="bar" style={{ width: `${(c.total / max) * 100}%` }}>
                    {c.open > 0 && <span className="seg coral" style={{ flex: c.open }} />}
                    {c.fixed > 0 && <span className="seg blue" style={{ flex: c.fixed }} />}
                    {c.verified > 0 && <span className="seg teal" style={{ flex: c.verified }} />}
                  </span>
                </span>
                <span className="bar-num">{c.total}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card flush">
        <div className="toolbar">
          <div className="tabs">
            {unreadIds.size > 0 && (
              <button className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>
                New <span className="count">{unreadIds.size}</span>
              </button>
            )}
            {TABS.map((t) => (
              <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="row wrap">
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Logged by">
              <option value="">Logged by anyone</option>
              <option value="autobot">Logged by Autobot</option>
              <option value="web">Logged manually</option>
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {Object.entries(CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <input type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn ghost" onClick={exportTests} title="Download every report as a regression test set">
              Export tests
            </button>
          </div>
        </div>

        {list.length === 0 ? (
          <div className="empty">
            {stats.total === 0 ? (
              <>
                <p><strong>No reports yet.</strong></p>
                <p className="muted">When Autobot gets something wrong, log it here, or tell Autobot “log this as feedback”.</p>
                <a className="btn primary" href="#/new">Report the first issue</a>
              </>
            ) : (
              <p className="muted">Nothing here.</p>
            )}
          </div>
        ) : (
          <>
          <div className="list-head" aria-hidden="true">
            <span />
            <span>Report</span>
            <span>Logged by</span>
            <span>Severity</span>
            <span>Stage</span>
          </div>
          <ul className="list">
            {list.map((r) => (
              <li key={r.id}>
                <a href={`#/r/${r.number}`}>
                  <span className="num">{unreadIds.has(r.id) && <span className="dot-new" title="New activity" />}#{r.number}</span>
                  <span className="grow">
                    <span className="title">{r.title}</span>
                    <span className="meta">
                      {CATEGORIES[r.category]?.label || r.category} · {ago(r.created_at)}
                    </span>
                  </span>
                  <SourceTag report={r} />
                  <SeverityTag severity={r.severity} />
                  <span className="stage"><StatusPill status={r.status} /></span>
                </a>
              </li>
            ))}
          </ul>
          </>
        )}
      </section>
    </div>
  )
}

function Stat(p: { label: string; value: number | string; tone?: string; sub?: string; onClick?: () => void }) {
  const Tag = p.onClick ? 'button' : 'div'
  return (
    <Tag className={`card stat ${p.tone ? `accent-${p.tone}` : ''}`} onClick={p.onClick}>
      <span className="stat-label">{p.label}</span>
      <span className="stat-value">{p.value}</span>
      {p.sub && <span className="stat-sub">{p.sub}</span>}
    </Tag>
  )
}
