// Notifications = things other people did since you last opened that report.
// Fixers hear about everything; reporters only about reports they filed or worked on.
import { useCallback, useEffect, useState } from 'react'
import { STATUSES, supabase, useLive, type Me, type Status, type Verdict } from './lib'

interface ReportRow {
  id: string
  number: number
  title: string
  status: Status
  source: string
  reported_by: string | null
  reporter_email: string | null
  created_at: string
}
interface EventRow {
  report_id: string
  kind: string
  verdict: Verdict | null
  to_status: Status | null
  author: string | null
  author_email: string | null
  created_at: string
}

export interface Notice {
  key: string
  reportId: string
  number: number
  title: string
  text: string
  when: string
  action?: string // e.g. "Retest" for reporters when something is fixed
  more: number // other unseen things on the same report
}

const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase())
const VERDICT = { pass: 'passed', partial: 'partly fixed', fail: 'still broken' }

function describe(e: EventRow, me: Me, current: Status): { text: string; action?: string } | null {
  const who = e.author || 'Someone'
  switch (e.kind) {
    case 'fix':
      if (me.role === 'fixer') return { text: `${who} marked it fixed` }
      // Only ask for a retest while it's still waiting for one
      return current === 'fixed' ? { text: `${who} fixed it. Please retest`, action: 'Retest' } : { text: `${who} marked it fixed` }
    case 'status':
      return { text: `${who} moved it to ${STATUSES[e.to_status!]?.label || 'a new stage'}` }
    case 'comment':
      return { text: `${who} replied` }
    case 'update':
      return { text: `${who} added an update` }
    case 'retest':
      return { text: `${who} retested it: ${VERDICT[e.verdict!] || 'done'}` }
    default:
      return null
  }
}

export function useNotifications(me: Me) {
  const [notices, setNotices] = useState<Notice[]>([])
  const [unreadReportIds, setUnreadReportIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    const since = new Date(Date.now() - 60 * 864e5).toISOString() // last 60 days
    const [{ data: reps }, { data: evs }, { data: views }] = await Promise.all([
      supabase.from('reports').select('id, number, title, status, source, reported_by, reporter_email, created_at'),
      supabase.from('events').select('report_id, kind, verdict, to_status, author, author_email, created_at').order('created_at'),
      supabase.from('report_views').select('report_id, seen_at'),
    ])
    const reports = new Map(((reps as ReportRow[]) || []).map((r) => [r.id, r]))
    const events = ((evs as EventRow[]) || []).filter((e) => e.created_at >= since)
    const seen = new Map(((views as { report_id: string; seen_at: string }[]) || []).map((v) => [v.report_id, v.seen_at]))

    // Reports I'm involved in (for reporters): filed by me, or I added an update/retest.
    const mine = new Set<string>()
    for (const r of reports.values()) if (same(r.reporter_email, me.email) || (!r.reporter_email && r.reported_by === me.name)) mine.add(r.id)
    for (const e of (evs as EventRow[]) || []) if (same(e.author_email, me.email)) mine.add(e.report_id)

    const out: Notice[] = []
    for (const r of reports.values()) {
      if (me.role !== 'fixer' || r.created_at < since || seen.has(r.id) || mine.has(r.id)) continue
      const by = r.source === 'autobot' ? `Autobot logged it${r.reported_by && r.reported_by !== 'Autobot' ? ` for ${r.reported_by}` : ''}` : `${r.reported_by || 'Someone'} reported it`
      out.push({ key: `r-${r.id}`, reportId: r.id, number: r.number, title: r.title, text: `New report · ${by}`, when: r.created_at, more: 0 })
    }
    for (const e of events) {
      const r = reports.get(e.report_id)
      if (!r || same(e.author_email, me.email)) continue
      if (me.role !== 'fixer' && !mine.has(r.id)) continue
      const last = seen.get(r.id)
      if (last && e.created_at <= last) continue
      const d = describe(e, me, r.status)
      if (d) out.push({ key: `e-${r.id}-${e.created_at}`, reportId: r.id, number: r.number, title: r.title, when: e.created_at, more: 0, ...d })
    }
    // One line per report: the newest thing, plus how many others. A pending "Retest" wins so it's never hidden.
    const byReport = new Map<string, Notice[]>()
    for (const n of out) byReport.set(n.reportId, [...(byReport.get(n.reportId) || []), n])
    const grouped = [...byReport.values()].map((list) => {
      list.sort((a, b) => (a.when < b.when ? 1 : -1))
      const top = list.find((n) => n.action) || list[0]
      return { ...top, when: list[0].when, more: list.length - 1 }
    })
    grouped.sort((a, b) => (a.when < b.when ? 1 : -1))
    setNotices(grouped)
    setUnreadReportIds(new Set(out.map((n) => n.reportId)))
  }, [me])

  useEffect(() => {
    refresh()
    const tick = setInterval(refresh, 60_000)
    const onFocus = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('report-seen', refresh)
    return () => {
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('report-seen', refresh)
    }
  }, [refresh])

  // Instant: new reports and timeline entries refresh the bell right away
  useLive([{ table: 'reports' }, { table: 'events' }], refresh)

  // "(3) Autobot Feedback" in the browser tab
  useEffect(() => {
    document.title = notices.length ? `(${notices.length}) Autobot Feedback` : 'Autobot Feedback'
  }, [notices.length])

  const markAllRead = useCallback(async () => {
    const ids = [...new Set(notices.map((n) => n.reportId))]
    const now = new Date().toISOString()
    if (ids.length)
      await supabase.from('report_views').upsert(
        ids.map((report_id) => ({ email: me.email.toLowerCase(), report_id, seen_at: now })),
        { onConflict: 'email,report_id' },
      )
    refresh()
  }, [notices, me, refresh])

  return { notices, unreadReportIds, refresh, markAllRead }
}
