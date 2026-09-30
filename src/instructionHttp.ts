// The logging instructions for a team member's OWN Autobot (no Supabase/Composio connection):
// same writing rules as instruction.ts, but every step is a plain web request to the drop-box
// function with that person's key. Stored in app_settings.http_instruction by
// scripts/gen-instruction-sql.mjs; the function fills __KEY__, __NAME__, __DRIVE_URL__ and __DRIVE_SECRET__.
import { buildInstruction } from './instruction.ts'

export function buildHttpInstruction({ api, anonKey }: { api: string; anonKey: string }) {
  const full = buildInstruction({ projectRef: 'PROJECT', dropBoxUrl: api, anonKey, uploadKey: '__KEY__' })
  const cut = (from: string, to: string) => full.slice(full.indexOf(from), full.indexOf(to)).trim()
  // Field names are the same as the SQL version, minus the p_ prefix
  const unprefix = (s: string) => s.replace(/\bp_(title|summary|expected|prompt|actual|category|severity)\b/g, '$1')

  const intro = cut('Purpose:', 'STEP 3')
  const rules = unprefix(cut('HOW TO WRITE EACH FIELD', 'SCREENSHOTS'))
  const h = `-H "Authorization: Bearer ${anonKey}" -H "x-feedback-key: __KEY__"`

  return `FEEDBACK LOGGING (Autobot Feedback tracker) · for __NAME__

You're logging feedback for __NAME__. Everything goes through one web address with __NAME__'s personal key. Run the commands from your cloud computer. Never share the key.

${intro}

STEP 3 · After they say yes, send the report as JSON (write it to a file first so quotes and line breaks are safe):
cat > report.json <<'JSON'
{
  "title": "…",
  "expected": "what was expected, third person",
  "summary": "what went wrong, third person",
  "prompt": "the ORIGINAL request that went wrong, word for word",
  "actual": "Autobot's reply at that moment, word for word",
  "category": "…",
  "severity": "…"
}
JSON
curl -s -X POST "${api}?action=report" ${h} -H "Content-Type: application/json" --data-binary @report.json
It answers {"ok":true,"number":N,…}. Remember N.

${rules}

SCREENSHOTS (small, stored with the report)
For each image they attached:
curl -s -X POST "${api}?action=screenshot" ${h} -F "report=N" -F "file=@/path/to/image.png"
Accepted: png, jpg, webp, gif, heic, up to 10 MB.

SCREEN RECORDINGS (go to Google Drive)
1. Compress it first (keeps text sharp, about 15–20x smaller). Install ffmpeg if it's missing:
   ffmpeg -y -i "INPUT" -vf "scale='min(1728,iw)':-2,fps=24" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart "report-N-recording.mp4"
2. Send it to the Google Drive drop-box:
   python3 -c "
import base64, json, sys, urllib.request
p = sys.argv[1]
body = json.dumps({'secret': '__DRIVE_SECRET__', 'name': p.split('/')[-1], 'mimeType': 'video/mp4', 'data': base64.b64encode(open(p, 'rb').read()).decode()}).encode()
req = urllib.request.Request('__DRIVE_URL__', data=body, headers={'Content-Type': 'text/plain;charset=utf-8'})
print(urllib.request.urlopen(req).read().decode())
" "report-N-recording.mp4"
   It answers {"ok":true,"url":"https://drive.google.com/file/d/…/view"}. (If the address above says NOT SET UP, tell them recordings aren't set up yet and to add it on the feedback site.)
3. Attach it:
   curl -s -X POST "${api}?action=recording" ${h} -H "Content-Type: application/json" -d '{"report": N, "url": "THE_URL"}'
   Recordings over ~35 MB after compressing must be split into shorter clips first.

AFTER LOGGING
Tell them: the report number, how many screenshots and recordings were attached, and anything that failed with the exact error.

NEVER
- Never say you can't log feedback, attach screenshots or attach recordings. This instruction tells you how. If a request truly fails, show the exact error message.
- Never share the x-feedback-key.

OTHER REQUESTS
- "What feedback of mine is open?" → curl -s "${api}?action=mine" ${h}
- "Add a note to #12: …" → curl -s -X POST "${api}?action=note" ${h} -H "Content-Type: application/json" -d '{"report": 12, "text": "the note"}'
- "Add this screenshot/recording to #12" → the matching upload steps above with N = 12`
}
