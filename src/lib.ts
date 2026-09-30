import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import { demoClient } from './demo'
import { uploadRecording } from './drive'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
/** No keys → demo mode with sample data held in the browser. */
export const demo = !(url && key)
/** False when the browser blocks this site from saving anything (so it can't keep you signed in). */
export const canRemember = (() => {
  try {
    localStorage.setItem('__remember_test', '1')
    localStorage.removeItem('__remember_test')
    return true
  } catch {
    return false
  }
})()
export const supabase: SupabaseClient = demo ? demoClient : createClient(url!, key!)

export type Status = 'open' | 'acknowledged' | 'fixed' | 'verified' | 'reopened' | 'wont_fix' | 'closed'
export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type Verdict = 'pass' | 'partial' | 'fail'

export interface Report {
  id: string
  number: number
  title: string
  category: string
  severity: Severity
  status: Status
  prompt: string
  actual_response: string | null
  expected_behavior: string | null
  summary: string | null
  notes: string | null
  conversation_url: string | null
  source: 'web' | 'autobot'
  reported_by: string | null
  reporter_email: string | null
  created_at: string
  updated_at: string
  verified_at: string | null
}

export interface Event {
  id: string
  report_id: string
  kind: 'comment' | 'fix' | 'retest' | 'status' | 'update'
  body: string | null
  response_text: string | null
  verdict: Verdict | null
  build: string | null
  from_status: Status | null
  to_status: Status | null
  author: string | null
  author_email: string | null
  created_at: string
}

export interface Attachment {
  id: string
  report_id: string
  event_id: string | null
  path: string | null // screenshot stored in Supabase
  url: string | null // recording in Google Drive
  kind: 'image' | 'video'
}

/** What a gallery shows: a stored screenshot (signed link) or a Drive recording. */
export interface Media {
  src: string
  kind: 'image' | 'video'
  drive: boolean
}

export const CATEGORIES: Record<string, { label: string; hint: string }> = {
  memory: { label: 'Forgot context', hint: 'Lost track of earlier messages, preferences or facts it was told' },
  instructions: { label: 'Ignored instructions', hint: 'Did something other than what was asked' },
  facts: { label: 'Wrong or made-up info', hint: 'Stated something false or invented details' },
  tone: { label: 'Tone & voice', hint: 'Too robotic, too long, too pushy, off-brand wording' },
  tools: { label: 'App / tool actions', hint: 'Composio actions failed, wrong app, wrong data sent' },
  reasoning: { label: 'Reasoning & steps', hint: 'Bad plan, skipped steps, illogical answer' },
  language: { label: 'Language', hint: 'Replied in the wrong language or translated badly' },
  brand: { label: 'Brand rules', hint: 'Broke a Convogenie / Autobot brand rule' },
  speed: { label: 'Speed', hint: 'Took far too long or got stuck' },
  app: { label: 'App bug (not the AI)', hint: 'The Autobot app itself: chat not loading, buttons, layout, crashes' },
  other: { label: 'Other', hint: 'Anything else' },
}

export const STATUSES: Record<Status, { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'coral' },
  acknowledged: { label: 'Acknowledged', tone: 'amber' },
  fixed: { label: 'Fixed · needs retest', tone: 'blue' },
  verified: { label: 'Verified', tone: 'teal' },
  reopened: { label: 'Reopened', tone: 'coral' },
  wont_fix: { label: "Won't fix", tone: 'grey' },
  closed: { label: 'Closed · no fix needed', tone: 'grey' },
}

export const SEVERITIES: Record<Severity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export const OPEN_STATUSES: Status[] = ['open', 'acknowledged', 'reopened']

// ── Tiny hash router ─────────────────────────────────────────
export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/')
  useEffect(() => {
    const on = () => {
      setHash(window.location.hash.slice(1) || '/')
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}
export const go = (path: string) => (window.location.hash = path)

// ── Screenshots ──────────────────────────────────────────────
export interface UploadContext {
  reportId: string
  reportNumber: number
  eventId: string | null
  me: Me
  onStatus?: (text: string) => void
}

/** App settings (e.g. google_client_id), cached after first load. */
let settingsCache: Promise<Record<string, string>> | null = null
export function appSettings(refresh = false) {
  if (refresh || !settingsCache)
    settingsCache = Promise.resolve(
      supabase
        .from('app_settings')
        .select('name, value')
        .then(({ data }) => Object.fromEntries(((data as { name: string; value: string }[]) || []).map((r) => [r.name, r.value]))),
    )
  return settingsCache
}

/**
 * Screenshots: compressed, stored in Supabase. Recordings: compressed, uploaded to Google Drive.
 * Links: Drive links pasted by hand.
 */
export async function uploadMedia(files: File[], links: string[], ctx: UploadContext) {
  const { compress } = await import('./compress')
  const { onStatus } = ctx
  const total = files.length
  for (const [i, original] of files.entries()) {
    const label = total > 1 ? ` ${i + 1} of ${total}` : ''
    const isVideo = original.type.startsWith('video/')
    onStatus?.(isVideo ? `Compressing recording${label}…` : `Compressing screenshot${label}…`)
    const file = await compress(original, (f) => onStatus?.(`Compressing recording${label}… ${Math.round(f * 100)}%`))

    if (isVideo) {
      const st = await appSettings()
      if (!st.drive_script_url || !st.drive_secret) throw new Error('Recordings need Google Drive, which an admin hasn’t set up yet (Settings → Google Drive). You can paste a Drive link instead.')
      const name = `Report #${ctx.reportNumber} – ${new Date().toISOString().slice(0, 10)} – ${original.name.replace(/\.\w+$/, '')}.mp4`
      onStatus?.(`Uploading recording to Google Drive${label}…`)
      const url = await uploadRecording(st.drive_script_url, st.drive_secret, file, name)
      const ins = await supabase.from('attachments').insert({ report_id: ctx.reportId, event_id: ctx.eventId, url, kind: 'video', size_bytes: file.size })
      if (ins.error) throw ins.error
      continue
    }

    onStatus?.(`Uploading screenshot${label}…`)
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const path = `${ctx.reportId}/${crypto.randomUUID()}.${ext}`
    const up = await supabase.storage.from('screenshots').upload(path, file, { contentType: file.type })
    if (up.error) throw up.error
    const ins = await supabase.from('attachments').insert({ report_id: ctx.reportId, event_id: ctx.eventId, path, kind: 'image', size_bytes: file.size })
    if (ins.error) throw ins.error
  }
  for (const url of links) {
    const ins = await supabase.from('attachments').insert({ report_id: ctx.reportId, event_id: ctx.eventId, url, kind: 'video' })
    if (ins.error) throw ins.error
  }
  onStatus?.('')
}

/** Turns attachment rows into things a gallery can show. */
export async function toMedia(atts: Attachment[]): Promise<(Attachment & { media: Media })[]> {
  const urls = await signedUrls(atts.filter((a) => a.path).map((a) => a.path!))
  return atts.flatMap((a): (Attachment & { media: Media })[] =>
    a.url
      ? [{ ...a, media: { src: a.url, kind: 'video' as const, drive: true } }]
      : a.path && urls[a.path]
        ? [{ ...a, media: { src: urls[a.path], kind: (/\.(mp4|mov|webm)$/i.test(a.path) ? 'video' : 'image') as Media['kind'], drive: false } }]
        : [],
  )
}

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data } = await supabase.storage.from('screenshots').createSignedUrls(paths, 60 * 60)
  const out: Record<string, string> = {}
  data?.forEach((d) => d.path && d.signedUrl && (out[d.path] = d.signedUrl))
  return out
}

// ── Formatting ───────────────────────────────────────────────
export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function download(name: string, text: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── Theme (saved per browser; defaults to light) ─────────────
export type Theme = 'light' | 'dark' | 'system'
export function getTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme) || 'light'
}
export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  try {
    localStorage.setItem('theme', t)
  } catch {
    /* browser blocks storage: theme still applies until the tab closes */
  }
}

// ── Who's signed in ──────────────────────────────────────────
export interface Me {
  name: string
  email: string
  role: 'reporter' | 'fixer'
  admin: boolean
}

/** Remember that I've opened this report, so its dot / "New for you" entry clears. */
export async function markSeen(me: Me, reportId: string) {
  await supabase
    .from('report_views')
    .upsert({ email: me.email.toLowerCase(), report_id: reportId, seen_at: new Date().toISOString() }, { onConflict: 'email,report_id' })
  window.dispatchEvent(new Event('report-seen'))
}

/** Is the Google Drive drop-box for recordings set up? (undefined while loading) */
export function useDriveReady() {
  const [ready, setReady] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    appSettings().then((st) => setReady(Boolean(st.drive_script_url && st.drive_secret)))
  }, [])
  return ready
}

// ── Live updates (Supabase Realtime) ─────────────────────────
type LiveSource = { table: 'reports' | 'events' | 'attachments'; filter?: string }
let liveChannelCount = 0

// Connection status for the little "Live" dot in the header
export type LiveStatus = 'connecting' | 'live' | 'error'
let liveStatus: LiveStatus = 'connecting'
function setLiveStatus(st: LiveStatus, detail: string) {
  if (st !== 'live') console.warn('[live updates]', st, detail)
  liveStatus = st
  window.dispatchEvent(new CustomEvent('live-status', { detail: st }))
}
export function useLiveStatus() {
  const [st, setSt] = useState<LiveStatus>(liveStatus)
  useEffect(() => {
    const on = (e: globalThis.Event) => setSt((e as CustomEvent<LiveStatus>).detail)
    window.addEventListener('live-status', on)
    return () => window.removeEventListener('live-status', on)
  }, [])
  return st
}

/**
 * Calls onChange (debounced) whenever any of these tables change.
 * Realtime applies the same access rules as normal reads.
 */
export function useLive(sources: LiveSource[], onChange: () => void) {
  const key = JSON.stringify(sources)
  const cb = useRef(onChange)
  cb.current = onChange
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const fire = () => {
      clearTimeout(timer)
      timer = setTimeout(() => cb.current(), 250)
    }
    let channel = supabase.channel(`live-${++liveChannelCount}`)
    for (const s of JSON.parse(key) as LiveSource[]) {
      channel = channel.on('postgres_changes' as never, { event: '*', schema: 'public', table: s.table, ...(s.filter ? { filter: s.filter } : {}) }, fire)
    }
    channel.subscribe((status, err) => {
      setLiveStatus(status === 'SUBSCRIBED' ? 'live' : status === 'CLOSED' ? liveStatus : 'error', err?.message || status)
    })
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [key])
}
