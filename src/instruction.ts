// Autobot's full logging instruction. Used by the Settings page, and by scripts/gen-instruction-sql.mjs
// to store it in the database, where Autobot reads it with: select public.logging_instruction();

export const buildInstruction = ({ projectRef, dropBoxUrl, anonKey, uploadKey }: { projectRef: string; dropBoxUrl: string; anonKey: string; uploadKey: string }) => `FEEDBACK LOGGING (Autobot Feedback tracker)

Purpose: tell Rahul exactly what Autobot did wrong, so the model's responses can be fixed. A report is NOT a transcript. Describe the mistake; keep the exact prompt and reply only as evidence.

When someone says "log this as feedback", "report this" or similar:

STEP 1 · Work out what Autobot actually did wrong.
- One mistake per report. If there are two separate mistakes (e.g. "misunderstood the request" and "the PDF had no links"), draft two reports.
- If the problem is with the Autobot app itself (chat not loading, buttons, layout, crashes) rather than with Autobot's answers, still log it, with type "app". Describe what the app did, e.g. "The Autobot chat stops loading older messages after scrolling up past about 50 messages."
- If the problem is with the feedback site (not Autobot), say so and don't log it.

STEP 2 · Draft it and SHOW it to them first, in exactly this format, then ask "Shall I log this?". Change it if they correct you.

  Title: <the specific mistake, under 12 words>
  What was expected: <1–2 sentences, third person: what Autobot should have done>
  What went wrong: <2–4 sentences, third person: what Autobot was asked, what it said or did instead, and why that was a problem>
  Type · severity: <type> · <severity> (<one-line reason>)
  Attachments: <screenshots/recordings to attach, or "none">

STEP 3 · After they say yes, run ONE SQL statement with the Supabase tool "Execute project database query" (NOT the read-only one, which can't save) on project ${projectRef}. Put every text value between $t$ markers so quotes are safe:

select public.log_report(
  p_title    => $t$…$t$,
  p_expected => $t$what was expected, third person$t$,
  p_summary  => $t$what went wrong, third person$t$,
  p_prompt   => $t$the ORIGINAL request that went wrong, word for word$t$,
  p_actual   => $t$Autobot's reply at that moment, word for word$t$,
  p_category => '…',
  p_severity => '…',
  p_reporter => $t$their first name$t$
);
It returns "Logged report #N: …". Remember N.

HOW TO WRITE EACH FIELD
- Always write about Autobot in the third person. Never "I was asked", "I did", "my reply".
    Good: "Autobot was asked to put the day's LinkedIn research into a guidebook PDF in Drive. It saved a short summary with no working links and said the guidebook was done."
    Bad:  "I was asked to make a PDF and I made a summary."
- p_title: the specific mistake. Good: "Saved a summary PDF with no working links instead of a full guide". Bad: "LinkedIn issue", "Request misunderstood".
- p_expected: what Autobot should have done, in plain words. Good: "Autobot should have kept replying in Hindi, including drafts." Never paste their complaint.
- p_summary: what went wrong: explain the mistake in your own words: what was asked, what Autobot said or did, why it was wrong. Never paste their complaint; describe it.
- p_prompt: only the request that went wrong, word for word (plus earlier messages ONLY if needed to understand it). Never their complaints or corrections. It is reused when retesting.
- p_actual: Autobot's reply at the moment of the mistake, word for word. Not a later reply. For app bugs with no reply, leave it out.
- If details are missing (e.g. where exactly the chat stops loading, any error shown), ask ONE short question before drafting; if they don't know, log it anyway and say what's unknown.
- p_category, one of:
    memory (forgot earlier context/preferences) · instructions (did something other than asked) · facts (wrong or made-up info) · tone (wording, length, style) · tools (a connected app/tool action failed or did the wrong thing) · reasoning (bad plan, skipped steps) · language (wrong language) · brand (broke a brand rule) · speed (too slow/stuck) · app (a bug in the Autobot app itself, not the AI) · other
- p_severity:
    critical = wrong action on a real app, or anything a customer saw · high = the task failed or had to be redone · medium = worked but needed correcting · low = cosmetic

EXAMPLE of a good report:
  Title: Switched to English after being told to reply in Hindi
  What was expected: Autobot should have kept replying in Hindi, including drafts, until told otherwise.
  What went wrong: Autobot was asked at the start to reply only in Hindi. Four messages later, asked to draft the Diwali offer, it wrote the draft in English without being told to switch. The draft had to be redone.
  Type · severity: memory · high (the draft had to be redone)

SCREENSHOTS (small, stored with the report)
For each image they attached, from your cloud computer:
curl -s -X POST "${dropBoxUrl}" \\
  -H "Authorization: Bearer ${anonKey}" \\
  -H "x-upload-key: ${uploadKey}" \\
  -F "report=N" \\
  -F "file=@/path/to/image.png"
A good upload answers {"ok":true,...}. Accepted: png, jpg, webp, gif, heic, up to 10 MB.

SCREEN RECORDINGS (go to Google Drive, never to the screenshot command above)
1. Compress it first on your cloud computer (keeps text sharp, about 15–20x smaller). Install ffmpeg if it's missing:
   ffmpeg -y -i "INPUT" -vf "scale='min(1728,iw)':-2,fps=24" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart "report-N-recording.mp4"
2. Send it to the Google Drive drop-box (it saves the file and shares it with the company):
   python3 -c "
import base64, json, sys, urllib.request
p = sys.argv[1]
body = json.dumps({'secret': '__DRIVE_SECRET__', 'name': p.split('/')[-1], 'mimeType': 'video/mp4', 'data': base64.b64encode(open(p, 'rb').read()).decode()}).encode()
req = urllib.request.Request('__DRIVE_URL__', data=body, headers={'Content-Type': 'text/plain;charset=utf-8'})
print(urllib.request.urlopen(req).read().decode())
" "report-N-recording.mp4"
   It answers {"ok":true,"url":"https://drive.google.com/file/d/…/view"}. Keep that url.
   (If the drop-box address above says NOT SET UP, upload the .mp4 with your Google Drive tool into the folder "Autobot Feedback recordings" instead, and share it with your company's Google Workspace domain as viewer.)
3. Attach it: select public.add_recording(N, $t$THE_URL$t$);
   Recordings over ~35 MB after compressing must be split into shorter clips first.

AFTER LOGGING
Tell them: the report number, how many screenshots and recordings were attached, and anything that failed with the exact error.

NEVER
- Never say you can't log feedback, attach screenshots or attach recordings. This instruction tells you how. If a tool truly fails, show the exact error message.
- Never share the x-upload-key.

OTHER REQUESTS
- "What feedback is open?" → select * from public.open_reports;
- "What needs retesting?" → select * from public.retest_queue;
- "Add a note to #12: …" → select public.add_note(12, $t$the note$t$);
- "Add this screenshot/recording to #12" → the matching upload steps above with N = 12`
