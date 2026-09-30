// Deployed in Supabase under the name "hyper-task" (the dashboard picked it; names can't be changed).
// Autobot's screenshot drop-box.
// POST multipart/form-data with fields: report (number), file (image)
// Header: x-upload-key: <the upload_key from app_secrets>
import { createClient } from 'npm:@supabase/supabase-js@2'

// Screen recordings go to Google Drive instead (see add_recording in the database).
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic' }
const MAX_BYTES = 10 * 1024 * 1024

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-upload-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return reply(405, { error: 'Use POST' })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: secret } = await db.from('app_secrets').select('value').eq('name', 'upload_key').maybeSingle()
  if (!secret || req.headers.get('x-upload-key') !== secret.value) {
    return reply(401, { error: 'Wrong or missing x-upload-key header' })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return reply(400, { error: 'Send multipart/form-data with fields "report" and "file"' })
  }

  const number = Number(form.get('report'))
  const file = form.get('file')
  if (!Number.isInteger(number) || number < 1) return reply(400, { error: 'Field "report" must be the report number, e.g. 12' })
  if (!(file instanceof File)) return reply(400, { error: 'Field "file" must be the image file' })
  if (file.size > MAX_BYTES) return reply(413, { error: 'Image is larger than 10 MB' })

  const ext = (file.name.split('.').pop() || '').toLowerCase()
  const type = Object.values(TYPES).includes(file.type) ? file.type : TYPES[ext]
  if (!type) return reply(415, { error: 'Only images are accepted (png, jpg, webp, gif, heic). Screen recordings go to Google Drive: use add_recording.' })

  const { data: report } = await db.from('reports').select('id').eq('number', number).maybeSingle()
  if (!report) return reply(404, { error: `No report #${number}` })

  const path = `${report.id}/${crypto.randomUUID()}.${Object.keys(TYPES).find((k) => TYPES[k] === type) || 'png'}`
  const up = await db.storage.from('screenshots').upload(path, await file.arrayBuffer(), { contentType: type })
  if (up.error) return reply(500, { error: up.error.message })

  const ins = await db.from('attachments').insert({ report_id: report.id, event_id: null, path, size_bytes: file.size })
  if (ins.error) return reply(500, { error: ins.error.message })

  return reply(200, { ok: true, message: `Attached screenshot to report #${number}` })
})
