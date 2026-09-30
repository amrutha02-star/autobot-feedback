// Deployed in Supabase under the name "hyper-task" (the dashboard picked it; names can't be changed).
// Autobot's door into the feedback site.
//
// 1) Screenshot drop-box (original):
//      POST multipart/form-data  fields: report (number), file (image)
//      header x-upload-key: <app_secrets.upload_key>   or   x-feedback-key: <a team member's personal key>
//
// 2) Personal Autobot API (each team member's own Autobot), header x-feedback-key: <their key>
//      GET  ?action=instruction   → the logging instructions, personalised (text)
//      POST ?action=report        JSON {title, expected, summary, prompt, actual, category, severity}
//      POST ?action=screenshot    multipart {report, file}      (same as 1)
//      POST ?action=recording     JSON {report, url}            (a Google Drive link)
//      POST ?action=note          JSON {report, text}
//      GET  ?action=mine          → your open reports
import { createClient } from 'npm:@supabase/supabase-js@2'

// Screen recordings go to Google Drive instead (action=recording attaches the link).
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic' }
const MAX_BYTES = 10 * 1024 * 1024
const CATEGORIES = ['memory', 'instructions', 'facts', 'tone', 'tools', 'reasoning', 'language', 'brand', 'speed', 'app', 'other']
const SEVERITIES = ['low', 'medium', 'high', 'critical']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-upload-key, x-feedback-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const text = (body: string) => new Response(body, { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } })

type Member = { email: string; name: string; role: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'screenshot'

  // Who is calling?
  let member: Member | null = null
  const personal = req.headers.get('x-feedback-key')
  if (personal) {
    const { data } = await db.from('team').select('email, name, role').eq('feedback_key', personal).maybeSingle()
    if (!data) return reply(401, { error: 'That personal key is not valid (it may have been reset). Copy the line again from Settings → Connect your Autobot.' })
    member = data as Member
  } else {
    const { data: secret } = await db.from('app_secrets').select('value').eq('name', 'upload_key').maybeSingle()
    if (!secret || req.headers.get('x-upload-key') !== secret.value) return reply(401, { error: 'Wrong or missing x-upload-key header' })
    if (action !== 'screenshot') return reply(401, { error: 'This action needs a personal x-feedback-key' })
  }

  const reportByNumber = async (n: unknown) => {
    const number = Number(n)
    if (!Number.isInteger(number) || number < 1) return { error: 'Field "report" must be the report number, e.g. 12' }
    const { data } = await db.from('reports').select('id, number').eq('number', number).maybeSingle()
    return data ? { report: data as { id: string; number: number } } : { error: `No report #${number}` }
  }

  // ── Personalised instructions ─────────────────────────────
  if (action === 'instruction') {
    const { data: rows } = await db.from('app_settings').select('name, value').in('name', ['http_instruction', 'drive_script_url', 'drive_secret'])
    const st = Object.fromEntries((rows || []).map((r: { name: string; value: string }) => [r.name, r.value]))
    if (!st.http_instruction) return reply(503, { error: 'The instructions are not set up yet (run the latest database update).' })
    return text(
      st.http_instruction
        .replaceAll('__KEY__', personal!)
        .replaceAll('__NAME__', member!.name)
        .replaceAll('__DRIVE_URL__', st.drive_script_url || 'NOT SET UP')
        .replaceAll('__DRIVE_SECRET__', st.drive_secret || 'NOT SET UP'),
    )
  }

  // ── Your open reports ─────────────────────────────────────
  if (action === 'mine') {
    const { data } = await db
      .from('reports')
      .select('number, title, status, updated_at')
      .ilike('reporter_email', member!.email)
      .not('status', 'in', '(verified,closed,wont_fix)')
      .order('number')
    return reply(200, { ok: true, reports: data || [] })
  }

  // ── Log a report ──────────────────────────────────────────
  if (action === 'report') {
    if (req.method !== 'POST') return reply(405, { error: 'Use POST' })
    const b = await req.json().catch(() => null)
    if (!b?.title || !b?.prompt) return reply(400, { error: 'Send JSON with at least "title" and "prompt" (plus expected, summary, actual, category, severity)' })
    const category = CATEGORIES.includes(String(b.category).toLowerCase()) ? String(b.category).toLowerCase() : 'other'
    const severity = SEVERITIES.includes(String(b.severity).toLowerCase()) ? String(b.severity).toLowerCase() : 'medium'
    const { data, error } = await db
      .from('reports')
      .insert({
        title: String(b.title),
        expected_behavior: b.expected ? String(b.expected) : null,
        summary: b.summary ? String(b.summary) : null,
        prompt: String(b.prompt),
        actual_response: b.actual ? String(b.actual) : null,
        category,
        severity,
        source: 'autobot',
        reported_by: member!.name,
        reporter_email: member!.email,
      })
      .select('number, title')
      .single()
    if (error) return reply(500, { error: error.message })
    return reply(200, { ok: true, number: data.number, message: `Logged report #${data.number}: ${data.title}` })
  }

  // ── Attach a Drive recording ──────────────────────────────
  if (action === 'recording') {
    const b = await req.json().catch(() => null)
    const found = await reportByNumber(b?.report)
    if (found.error) return reply(400, { error: found.error })
    if (!/^https:\/\/(drive|docs)\.google\.com\//.test(String(b?.url))) return reply(400, { error: 'Field "url" must be a Google Drive link' })
    const { error } = await db.from('attachments').insert({ report_id: found.report!.id, event_id: null, url: String(b.url), kind: 'video' })
    if (error) return reply(500, { error: error.message })
    return reply(200, { ok: true, message: `Attached recording to report #${found.report!.number}` })
  }

  // ── Add a note ────────────────────────────────────────────
  if (action === 'note') {
    const b = await req.json().catch(() => null)
    const found = await reportByNumber(b?.report)
    if (found.error) return reply(400, { error: found.error })
    if (!b?.text) return reply(400, { error: 'Field "text" is required' })
    const { error } = await db
      .from('events')
      .insert({ report_id: found.report!.id, kind: 'update', body: String(b.text), author: member!.name, author_email: member!.email })
    if (error) return reply(500, { error: error.message })
    return reply(200, { ok: true, message: `Added an update to report #${found.report!.number}` })
  }

  // ── Screenshot (default) ──────────────────────────────────
  if (action !== 'screenshot') return reply(400, { error: `Unknown action "${action}"` })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST' })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return reply(400, { error: 'Send multipart/form-data with fields "report" and "file"' })
  }

  const found = await reportByNumber(form.get('report'))
  const file = form.get('file')
  if (found.error) return reply(400, { error: found.error })
  if (!(file instanceof File)) return reply(400, { error: 'Field "file" must be the image file' })
  if (file.size > MAX_BYTES) return reply(413, { error: 'Image is larger than 10 MB' })

  const ext = (file.name.split('.').pop() || '').toLowerCase()
  const type = Object.values(TYPES).includes(file.type) ? file.type : TYPES[ext]
  if (!type) return reply(415, { error: 'Only images are accepted (png, jpg, webp, gif, heic). Screen recordings go to Google Drive.' })

  const report = found.report!
  const path = `${report.id}/${crypto.randomUUID()}.${Object.keys(TYPES).find((k) => TYPES[k] === type) || 'png'}`
  const up = await db.storage.from('screenshots').upload(path, await file.arrayBuffer(), { contentType: type })
  if (up.error) return reply(500, { error: up.error.message })

  const ins = await db.from('attachments').insert({ report_id: report.id, event_id: null, path, size_bytes: file.size })
  if (ins.error) return reply(500, { error: ins.error.message })

  return reply(200, { ok: true, message: `Attached screenshot to report #${report.number}` })
})
