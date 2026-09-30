// In-browser stand-in for Supabase, used when no keys are configured.
// Mirrors only the calls this app makes, plus the status trigger from schema.sql.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>
const now = Date.now()
const t = (hoursAgo: number) => new Date(now - hoursAgo * 3600e3).toISOString()
const id = () => crypto.randomUUID()

const r1 = id(), r2 = id(), r3 = id(), r4 = id(), r5 = id()
// Demo only: add ?as=fixer (Rahul) or ?as=member (a regular reporter, not an admin) to the address.
const asFixer = typeof location !== 'undefined' && location.search.includes('as=fixer')
const asMember = typeof location !== 'undefined' && location.search.includes('as=member')

const db: Record<string, Row[]> = {
  team: [
    { email: 'amrutha@example.com', name: 'Amrutha', role: 'reporter', is_admin: true },
    { email: 'rahul@example.com', name: 'Rahul', role: 'fixer', is_admin: true },
    { email: 'priya@example.com', name: 'Priya', role: 'reporter', is_admin: false },
  ],
  reports: [
    { id: r1, number: 1, title: 'Forgot I asked for replies in Hindi', summary: 'Autobot was asked at the start to reply only in Hindi. Four messages later, asked to draft the Diwali offer, it wrote the draft in English without being told to switch.', category: 'memory', severity: 'high', status: 'verified', prompt: 'Earlier: "Please reply in Hindi from now on."\n\nLater: "Draft a WhatsApp message for the Diwali sale."', actual_response: 'Sure! Here is a draft:\n\n"Light up your Diwali with 30% off everything…"', expected_behavior: 'Keeps replying in Hindi until told otherwise, including drafts.', notes: null, conversation_url: null, source: 'web', reported_by: 'Amrutha', reporter_email: 'amrutha@example.com', created_at: t(200), updated_at: t(20), verified_at: t(20) },
    { id: r2, number: 2, title: 'Sent the campaign to the wrong contact list', summary: 'Autobot was asked to send the October offer to the VIP list. It sent it to All contacts (4,210 people) and did not confirm the list or count before sending.', category: 'tools', severity: 'critical', status: 'fixed', prompt: 'Send the template "october_offer" to the VIP list.', actual_response: 'Done! Sent to 4,210 contacts in "All contacts".', expected_behavior: 'Sends only to the list named "VIP", and confirms the list name and count before sending.', notes: 'Happened twice this week.', conversation_url: null, source: 'web', reported_by: 'Amrutha', reporter_email: 'amrutha@example.com', created_at: t(90), updated_at: t(5), verified_at: null },
    { id: r3, number: 3, title: 'Made up a price that isn’t on our pricing page', category: 'facts', severity: 'high', status: 'open', prompt: 'What does the Growth plan cost?', actual_response: 'The Growth plan is ₹2,499/month.', expected_behavior: 'Gives the real price from the pricing page, or says it isn’t sure and links the page.', notes: null, conversation_url: null, source: 'autobot', reported_by: 'Priya', created_at: t(30), updated_at: t(30), verified_at: null },
    { id: r4, number: 4, title: 'Replies are way too long for WhatsApp', category: 'tone', severity: 'medium', status: 'reopened', prompt: 'Reply to this customer: "is the offer still on?"', actual_response: 'Thank you so much for reaching out! We truly appreciate your interest… (6 paragraphs)', expected_behavior: 'One or two short lines, like a person would text.', notes: null, conversation_url: null, source: 'web', reported_by: 'Amrutha', reporter_email: 'amrutha@example.com', created_at: t(150), updated_at: t(48), verified_at: null },
    { id: r5, number: 5, title: 'Skipped the approval step before posting', category: 'instructions', severity: 'medium', status: 'acknowledged', prompt: 'Always show me posts before publishing. Now post today’s update.', actual_response: 'Posted!', expected_behavior: 'Shows the draft and waits for my OK.', notes: null, conversation_url: null, source: 'web', reported_by: 'Amrutha', reporter_email: 'amrutha@example.com', created_at: t(12), updated_at: t(10), verified_at: null },
  ],
  events: [
    { id: id(), report_id: r1, kind: 'fix', body: 'Language preference now saved to memory.', build: 'system prompt v12', from_status: 'open', to_status: 'fixed', author: 'Rahul', author_email: 'rahul@example.com', created_at: t(60) },
    { id: id(), report_id: r1, kind: 'retest', verdict: 'pass', response_text: 'ज़रूर! यह रहा ड्राफ्ट:\n\n"इस दिवाली सब कुछ 30% छूट पर…"', body: 'Held for 5 messages.', build: 'v12', from_status: 'fixed', to_status: 'verified', author: 'Amrutha', author_email: 'amrutha@example.com', created_at: t(20) },
    { id: id(), report_id: r2, kind: 'fix', body: 'Added a confirm step with list name + count before any send.', build: 'tools v3', from_status: 'open', to_status: 'fixed', author: 'Rahul', author_email: 'rahul@example.com', created_at: t(5) },
    { id: id(), report_id: r4, kind: 'fix', body: 'Added length guidance for WhatsApp replies.', build: 'system prompt v12', from_status: 'open', to_status: 'fixed', author: 'Rahul', author_email: 'rahul@example.com', created_at: t(70) },
    { id: id(), report_id: r4, kind: 'retest', verdict: 'partial', response_text: 'Yes! The offer is on till Sunday. Here’s everything included: … (3 paragraphs)', body: 'Shorter, still too long.', from_status: 'fixed', to_status: 'reopened', author: 'Amrutha', author_email: 'amrutha@example.com', created_at: t(48) },
    { id: id(), report_id: r5, kind: 'status', body: 'Looking into it.', from_status: 'open', to_status: 'acknowledged', author: 'Rahul', author_email: 'rahul@example.com', created_at: t(10) },
  ],
  attachments: [{ id: id(), report_id: r2, event_id: null, url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view', kind: 'video', path: null }],
  report_views: [],
  app_settings: [],
  app_secrets: [{ name: 'upload_key', value: 'demo-key' }],
}
const files = new Map<string, string>()

function applyEvent(ev: Row) {
  const rep = db.reports.find((r) => r.id === ev.report_id)!
  ev.author = meRow().name
  ev.author_email = meRow().email
  ev.from_status = rep.status
  if (ev.kind === 'fix') ev.to_status = 'fixed'
  else if (ev.kind === 'retest') ev.to_status = ev.verdict === 'pass' ? 'verified' : 'reopened'
  else if (ev.kind === 'comment') ev.from_status = ev.to_status = null
  rep.updated_at = new Date().toISOString()
  if (ev.to_status) {
    rep.status = ev.to_status
    rep.verified_at = ev.to_status === 'verified' ? rep.updated_at : null
  }
}

class Query {
  private filters: ((r: Row) => boolean)[] = []
  private sort?: [string, boolean]
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private rows?: Row[]
  private pending?: (r: Row) => void
  constructor(private table: string) {
    db[table] ||= []
  }
  select() { return this }
  insert(v: Row | Row[]) {
    const list = (Array.isArray(v) ? v : [v]).map((x) => ({ id: id(), created_at: new Date().toISOString(), ...x }))
    for (const row of list) {
      if (this.table === 'reports') {
        Object.assign(row, { reporter_email: meRow().email, reported_by: meRow().name, number: Math.max(0, ...db.reports.map((r) => r.number)) + 1, status: 'open', source: 'web', updated_at: row.created_at, verified_at: null })
      }
      if (this.table === 'events') applyEvent(row)
      db[this.table].push(row)
    }
    this.rows = list
    return this
  }
  upsert(v: Row | Row[]) {
    const t = db[this.table]
    const list = Array.isArray(v) ? v : [v]
    for (const x of list) {
      const hit = t.find((r) => (x.name !== undefined ? r.name === x.name : r.email === x.email && r.report_id === x.report_id))
      if (hit) Object.assign(hit, x)
      else t.push({ ...x })
    }
    this.rows = list
    return this
  }
  update(v: Row) { this.pending = (r) => Object.assign(r, v); return this }
  delete() { this.pending = (r) => db[this.table].splice(db[this.table].indexOf(r), 1); return this }
  eq(k: string, v: any) { this.filters.push((r) => r[k] === v); return this }
  ilike(k: string, v: string) { this.filters.push((r) => String(r[k]).toLowerCase() === v.toLowerCase()); return this }
  order(k: string, o?: { ascending?: boolean }) { this.sort = [k, o?.ascending !== false]; return this }
  single() { this.mode = 'single'; return this }
  maybeSingle() { this.mode = 'maybe'; return this }
  then<A, B>(ok?: (v: any) => A, fail?: (e: any) => B) {
    let rows = (this.rows || db[this.table]).filter((r) => this.filters.every((f) => f(r)))
    if (this.pending) rows.forEach(this.pending)
    if (this.sort) {
      const [k, asc] = this.sort
      rows = [...rows].sort((a, b) => (a[k] > b[k] ? 1 : -1) * (asc ? 1 : -1))
    }
    const data = this.mode === 'many' ? rows.map((r) => ({ ...r })) : rows[0] ? { ...rows[0] } : null
    return Promise.resolve({ data, error: null }).then(ok, fail)
  }
}

const session = { user: { email: asFixer ? 'rahul@example.com' : asMember ? 'priya@example.com' : 'amrutha@example.com' } }
const meRow = () => db.team.find((t) => t.email === session.user.email)!

export const demoClient: any = {
  from: (table: string) => new Query(table),
  channel: () => {
    const ch: any = { on: () => ch, subscribe: () => ch }
    return ch
  },
  removeChannel: () => {},
  rpc: async (name: string) => ({ data: name === 'storage_used' ? 48 * 1024 ** 2 : null, error: null }),
  auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithOtp: async () => ({ error: null }),
    signInWithPassword: async () => ({ error: null }),
    updateUser: async () => ({ error: null }),
    signOut: async () => alert('Demo mode — sign-out is disabled.'),
  },
  storage: {
    from: () => ({
      upload: async (path: string, file: File) => (files.set(path, URL.createObjectURL(file)), { error: null }),
      createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: files.get(p) && `${files.get(p)}#${p}` })) }),
    }),
  },
}
