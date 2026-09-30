import { useCallback, useEffect, useState } from 'react'
import { appSettings, getTheme, setTheme, supabase, type Theme } from '../lib'
import { buildInstruction } from '../instruction'
import { DRIVE_FOLDER, buildDriveScript, testDriveScript } from '../drive'

interface Member {
  email: string
  name: string
  role: 'reporter' | 'fixer'
  is_admin?: boolean
}

const ROLES = {
  reporter: 'Reporter: files and retests issues',
  fixer: 'Fixer: works on Autobot and marks fixes',
}

export default function Settings({ myEmail, admin }: { myEmail: string; admin: boolean }) {
  return (
    <div className="stack narrow">
      <Appearance />
      <ConnectAutobot />
      {admin && <Team myEmail={myEmail} />}
      {admin && <Storage />}
      {admin && <GoogleDrive />}
      {admin && <AutobotConnection />}
    </div>
  )
}

const THEMES: { key: Theme; label: string; hint: string }[] = [
  { key: 'light', label: 'Light', hint: 'Warm off-white' },
  { key: 'dark', label: 'Dark', hint: 'Soft charcoal' },
  { key: 'system', label: 'Match my computer', hint: 'Follows your Mac’s setting' },
]

function Appearance() {
  const [theme, set] = useState<Theme>(getTheme())
  return (
    <section className="card">
      <h1>Appearance</h1>
      <p className="muted">Saved in this browser.</p>
      <div className="theme-options" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.key}
            role="radio"
            aria-checked={theme === t.key}
            className={`theme-option ${theme === t.key ? 'on' : ''}`}
            onClick={() => {
              setTheme(t.key)
              set(t.key)
            }}
          >
            <span className={`swatch swatch-${t.key}`} />
            <strong>{t.label}</strong>
            <span className="muted small">{t.hint}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Team({ myEmail }: { myEmail: string }) {
  const [members, setMembers] = useState<Member[]>([])
  const [form, setForm] = useState({ name: '', email: '', role: 'reporter' as Member['role'] })
  const [error, setError] = useState('')
  const [added, setAdded] = useState('')

  const load = useCallback(() => {
    supabase
      .from('team')
      .select('email, name, role, is_admin')
      .order('name')
      .then(({ data }) => setMembers((data as Member[]) || []))
  }, [])
  useEffect(load, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const email = form.email.trim().toLowerCase()
    const { error } = await supabase.from('team').insert({ ...form, email, name: form.name.trim() })
    if (error) {
      setError(error.code === '23505' ? 'That email is already on the team.' : error.message)
      return
    }
    setAdded(email)
    setForm({ name: '', email: '', role: 'reporter' })
    load()
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.name} (${m.email})? They won't be able to sign in any more. Their past reports stay.`)) return
    await supabase.from('team').delete().eq('email', m.email)
    load()
  }

  async function setRole(m: Member, role: Member['role']) {
    await supabase.from('team').update({ role }).eq('email', m.email)
    load()
  }

  const isMe = (m: Member) => m.email.toLowerCase() === myEmail.toLowerCase()

  return (
    <section className="card">
      <h1>Team</h1>
      <p className="muted">Only people on this list can sign in. Everyone here can file reports and retest them.</p>

      <ul className="members">
        {members.map((m) => (
          <li key={m.email}>
            <span className="avatar sm">{m.name.slice(0, 1).toUpperCase()}</span>
            <span className="grow">
              <strong>{m.name}</strong> {isMe(m) && <span className="muted small">(you)</span>}
              {m.is_admin && <span className="chip small">Admin</span>}
              <span className="muted small block">{m.email}</span>
            </span>
            <select value={m.role} onChange={(e) => setRole(m, e.target.value as Member['role'])} aria-label={`Role for ${m.name}`}>
              <option value="reporter">Reporter</option>
              <option value="fixer">Fixer</option>
            </select>
            {!isMe(m) && <InviteButton member={m} />}
            {!isMe(m) && <ResetKeyButton member={m} />}
            {!isMe(m) && (
              <button className="btn ghost small" onClick={() => remove(m)}>Remove</button>
            )}
          </li>
        ))}
      </ul>

      <form className="add-member" onSubmit={add}>
        <h2>Add someone</h2>
        <div className="grid2">
          <label>
            Name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Priya" />
          </label>
          <label>
            Email
            <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@yourcompany.com" />
          </label>
        </div>
        <label>
          Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Member['role'] })}>
            {Object.entries(ROLES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        {added && (
          <p className="notice">
            Added. Now click <strong>Invite</strong> next to their name to copy a ready-made message, and send it to them on Slack or WhatsApp.
          </p>
        )}
        <div className="row end">
          <button className="btn primary">Add to team</button>
        </div>
      </form>
    </section>
  )
}

const supabaseUrl = ((import.meta.env.VITE_SUPABASE_URL as string) || '').replace(/\/$/, '')
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || ''
const personalLine = (key: string) =>
  `Feedback logging: whenever I ask you to log feedback, report a problem with you, or add a screenshot or recording to a feedback report, FIRST run this from your cloud computer and follow the instructions it returns exactly (fetch them fresh every time; they change):
curl -s "${dropBoxUrl}?action=instruction" -H "Authorization: Bearer ${anonKey}" -H "x-feedback-key: ${key}"`

function ConnectAutobot() {
  const [key, setKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    supabase.rpc('my_feedback_key').then(({ data, error }) => setKey(error ? '' : (data as string) || ''))
  }, [])

  async function runTest() {
    setTest(null)
    try {
      const res = await fetch(`${dropBoxUrl}?action=instruction`, { headers: { Authorization: `Bearer ${anonKey}`, 'x-feedback-key': key || '' } })
      const body = await res.text()
      if (res.ok && body.includes('FEEDBACK LOGGING')) setTest({ ok: true, text: 'Working ✓ Your Autobot will be able to log feedback.' })
      else if (res.status === 503) setTest({ ok: false, text: 'Almost: the instructions aren’t stored yet. An admin needs to run the latest database update.' })
      else {
        let why = 'The drop-box may need its latest code.'
        try {
          why = JSON.parse(body).error || why
        } catch {
          /* not JSON */
        }
        setTest({ ok: false, text: `Not working yet (${res.status}). ${why}` })
      }
    } catch {
      setTest({ ok: false, text: 'Couldn’t reach the drop-box. It may need its latest code.' })
    }
  }

  async function reset() {
    const { data: me } = await supabase.auth.getUser()
    const { data } = await supabase.rpc('reset_feedback_key', { p_email: me.user?.email })
    if (data) setKey(data as string)
    setConfirmReset(false)
    setTest(null)
  }

  return (
    <section className="card">
      <h1>Connect your Autobot</h1>
      <p className="muted">
        Do this once, in <strong>your own</strong> Autobot. Then you can say <em>“log this as feedback”</em> in any chat, and the report shows up here under your name,
        with screenshots and recordings.
      </p>
      {key === '' ? (
        <p className="warn small">Not available yet: an admin needs to run the latest database update.</p>
      ) : (
        <>
          <ol className="steps">
            <li>Click <strong>Copy</strong> below.</li>
            <li>In your Autobot, paste it into its instructions (or into a chat, asking Autobot to remember it).</li>
            <li>Click <strong>Test</strong> to check it works.</li>
          </ol>
          <div className="row between">
            <span className="label">Your line for Autobot</span>
            <span className="row gap-s">
              <button className="btn ghost small" onClick={runTest} disabled={!key}>Test</button>
              <button
                className="btn primary small"
                disabled={!key}
                onClick={() => {
                  navigator.clipboard.writeText(personalLine(key || ''))
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
              >
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </span>
          </div>
          <pre className="reply">{key ? personalLine('•'.repeat(12) + key.slice(-4)) : 'Loading…'}</pre>
          {test && <p className={`small ${test.ok ? 'ok-text' : 'error'}`}>{test.text}</p>}
          <p className="muted small">
            This line contains your personal key, so don't share it: anyone with it could log reports as you.{' '}
            {confirmReset ? (
              <>
                Make a new key? Your Autobot stops logging until you paste the new line.{' '}
                <button className="link-btn small" onClick={reset}>Yes, reset</button> ·{' '}
                <button className="link-btn small" onClick={() => setConfirmReset(false)}>Cancel</button>
              </>
            ) : (
              <button className="link-btn small" onClick={() => setConfirmReset(true)}>Reset my key</button>
            )}
          </p>
        </>
      )}
    </section>
  )
}

function ResetKeyButton({ member }: { member: Member }) {
  const [state, setState] = useState<'idle' | 'confirm' | 'done'>('idle')
  if (state === 'done') return <span className="ok-text small">Key reset ✓</span>
  if (state === 'confirm')
    return (
      <span className="row gap-s">
        <button
          className="btn ghost small"
          onClick={async () => {
            await supabase.rpc('reset_feedback_key', { p_email: member.email })
            setState('done')
          }}
        >
          Yes, reset
        </button>
        <button className="btn ghost small" onClick={() => setState('idle')}>Cancel</button>
      </span>
    )
  return (
    <button className="btn ghost small" title={`Stops ${member.name}'s Autobot from logging until they copy their new line`} onClick={() => setState('confirm')}>
      Reset Autobot key
    </button>
  )
}

function InviteButton({ member }: { member: Member }) {
  const [copied, setCopied] = useState(false)
  const site = window.location.origin
  const text = `Hi ${member.name}! You've been added to Autobot Feedback, where we log what Autobot gets wrong and track the fixes.

1. Open ${site}
2. Choose "Email me a link" and enter ${member.email}
3. Open the email and click the link (same browser)
4. Click your initial (top right) → Set password, so next time you just sign in with your password.
5. In Settings → Connect your Autobot, copy your line and paste it into your own Autobot's instructions. Then you can just tell Autobot "log this as feedback".

${member.role === 'fixer' ? "You're set up as the fixer: you can mark reports as fixed and move them between stages." : "You can report issues, add updates and retest fixes."}`
  return (
    <button
      className="btn ghost small"
      title="Copy an invite message to send on Slack or WhatsApp"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? 'Copied ✓' : 'Invite'}
    </button>
  )
}

const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || 'YOUR-PROJECT-REF'
const dropBoxUrl = `${supabaseUrl}/functions/v1/hyper-task`

const instruction = (uploadKey: string) => buildInstruction({ projectRef, dropBoxUrl, anonKey, uploadKey })

const STANDING_LINE = `Feedback logging: whenever someone asks you to log feedback, report a problem, or add a screenshot or recording to a feedback report, FIRST run  select public.logging_instruction();  with the Supabase tool "Execute project database query" on project ${projectRef}, then follow the instructions it returns exactly. Fetch them fresh every time; they change.`

const BACKUP_ROUTINE = `BACKUP ROUTINE (Autobot Feedback tracker)

Run this every Monday at 9:00 AM (India time), and whenever someone says "back up the feedback site".

1. With the Supabase tool "Execute project database query" on project ${projectRef}, run:
   select public.export_all();
2. Save the result, unchanged, as a file named autobot-feedback-backup-YYYY-MM-DD.json (today's date).
3. Upload it with your Google Drive tool into the folder "Autobot Feedback backups" (create it if missing).
   Share that folder ONLY with the site's admins (it contains client conversations). Get their emails with:  select email from public.team where is_admin;  Never share it with the whole domain or "anyone with the link".
4. Keep the 12 newest backups in that folder; move older ones to the Drive trash.
5. Message Amrutha one line: "Feedback backup done: N reports, N timeline entries, N attachments" using the counts in the file.
   If any step fails, message the exact error instead. Never skip silently.

Note: screenshots themselves aren't in the file (only their references). Recordings are already in Google Drive.`

type TestState = { kind: 'idle' | 'busy' | 'ok' | 'bad'; text?: string }

function Storage() {
  const [used, setUsed] = useState<number | null>(null)
  useEffect(() => {
    supabase.rpc('storage_used').then(({ data }) => setUsed(typeof data === 'number' ? data : Number(data ?? 0)))
  }, [])
  const LIMIT = 1024 ** 3
  const pct = used === null ? 0 : Math.min(100, (used / LIMIT) * 100)
  const mb = (b: number) => (b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)
  return (
    <section className="card">
      <h1>Screenshot storage</h1>
      <p className="muted">Free plan: 1 GB for screenshots. Recordings go to Google Drive and don't count here.</p>
      <div className="meter" aria-label="Storage used">
        <span style={{ width: `${pct}%` }} className={pct > 80 ? 'hot' : ''} />
      </div>
      <p className="small">
        {used === null
          ? 'Checking…'
          : `${mb(used)} MB used of 1 GB · ${pct < 50 ? 'plenty of space' : pct < 80 ? 'about half used' : ''} (room for about ${Math.max(0, Math.floor((LIMIT - used) / (0.2 * 1024 ** 2))).toLocaleString()} more screenshots)`}
        {pct > 80 && <strong className="error"> Running low. Tell Claude so we can move older screenshots out.</strong>}
      </p>
    </section>
  )
}

function GoogleDrive() {
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    appSettings(true).then(async (st) => {
      let sec = st.drive_secret
      if (!sec) {
        // First visit: make the secret the script and the site share
        sec = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
        await supabase.from('app_settings').upsert({ name: 'drive_secret', value: sec })
        appSettings(true)
      }
      setSecret(sec)
      setUrl(st.drive_script_url || '')
      setSaved(st.drive_script_url || '')
    })
  }, [])

  async function save() {
    // Company (Workspace) accounts give /a/macros/<domain>/s/…; the plain /macros/s/… form reaches the same script.
    const v = url.trim().replace(/^https:\/\/script\.google\.com\/a\/macros\/[^/]+\/s\//, 'https://script.google.com/macros/s/')
    setUrl(v)
    setMsg(null)
    if (v && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(v))
      return setMsg({ ok: false, text: 'That doesn’t look right. It should start with https://script.google.com/ and end with /exec' })
    setBusy(true)
    if (v && !(await testDriveScript(v))) {
      setBusy(false)
      return setMsg({
        ok: false,
        text: 'Couldn’t reach it. In script.google.com open Deploy → Manage deployments and check “Who has access” is “Anyone” (not “Anyone within” your company). If you changed it, copy the Web app URL again.',
      })
    }
    const { error } = v
      ? await supabase.from('app_settings').upsert({ name: 'drive_script_url', value: v })
      : await supabase.from('app_settings').delete().eq('name', 'drive_script_url')
    setBusy(false)
    if (error) return setMsg({ ok: false, text: error.message })
    appSettings(true)
    setSaved(v)
    setMsg({ ok: true, text: v ? 'Connected ✓ Recordings will now go to Google Drive.' : 'Removed.' })
  }

  return (
    <section className="card">
      <h1>Google Drive for recordings</h1>
      <p className="muted">
        Recordings are compressed, then saved to the folder “{DRIVE_FOLDER}” in the Google Drive of whoever sets this up, viewable by everyone at Convogenie. Autobot
        uses the same drop-box. Nobody has to sign in to Google on this site.
      </p>
      <p className={`small ${saved ? 'ok-text' : 'muted'}`}>{saved === null ? 'Checking…' : saved ? 'Connected ✓' : 'Not set up yet.'}</p>
      <details className="setup" open={saved === ''}>
        <summary>{saved ? 'Change the setup' : 'Set it up (one time, about 3 minutes)'}</summary>
        <ol className="steps">
          <li>
            <button
              className="btn primary small"
              disabled={!secret}
              onClick={() => {
                navigator.clipboard.writeText(buildDriveScript(secret))
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
            >
              {copied ? 'Copied ✓' : 'Copy the script'}
            </button>
          </li>
          <li>
            Open <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com (new project)</a>, signed in with your{' '}
            <strong>company Google account</strong>. Select all the sample code, delete it, and paste. Click the <strong>💾 Save</strong> icon.
          </li>
          <li>
            Click <strong>Deploy → New deployment</strong>. Click the ⚙️ gear next to “Select type” and choose <strong>Web app</strong>. Set <strong>Execute as: Me</strong> and{' '}
            <strong>Who has access: Anyone</strong>. Click <strong>Deploy</strong>.
            <small className="block">“Anyone” is needed so the site can reach it; the secret code inside the script blocks everyone else.</small>
          </li>
          <li>
            Google asks you to <strong>Authorize access</strong>: pick your account. If it says “Google hasn’t verified this app”, click <strong>Advanced → Go to … (unsafe)</strong>{' '}
            → <strong>Allow</strong>. (It’s your own script, so that’s expected.)
          </li>
          <li>Copy the <strong>Web app URL</strong> (ends with <code>/exec</code>), paste it below, and click <strong>Save & test</strong>.</li>
        </ol>
        <div className="row">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
          <button className="btn primary small" onClick={save} disabled={busy}>{busy ? 'Testing…' : 'Save & test'}</button>
        </div>
        {msg && <p className={`small ${msg.ok ? 'ok-text' : 'error'}`}>{msg.text}</p>}
      </details>
    </section>
  )
}

function AutobotConnection() {
  const [copied, setCopied] = useState(false)
  const [copiedBackup, setCopiedBackup] = useState(false)
  const [key, setKey] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })

  useEffect(() => {
    supabase
      .from('app_secrets')
      .select('value')
      .eq('name', 'upload_key')
      .maybeSingle()
      .then(({ data }) => setKey((data as { value: string } | null)?.value || ''))
  }, [])

  const text = instruction(key || 'RUN-UPDATE-3-FIRST')

  async function runTest() {
    setTest({ kind: 'busy' })
    // Sends no real image: report 0 is invalid on purpose. If the key is accepted,
    // the drop-box answers "report must be the report number". That proves it works.
    const form = new FormData()
    form.append('report', '0')
    try {
      const res = await fetch(dropBoxUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${anonKey}`, 'x-upload-key': key || '' },
        body: form,
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 400 && String(body.error || '').includes('report number')) setTest({ kind: 'ok', text: 'Drop-box is working. Autobot can attach screenshots.' })
      else if (res.status === 404) setTest({ kind: 'bad', text: 'Drop-box not found. The "hyper-task" function isn’t deployed in Supabase.' })
      else if (res.status === 401) setTest({ kind: 'bad', text: 'The drop-box rejected the key. Make sure update 3 was run in the SQL Editor.' })
      else setTest({ kind: 'bad', text: `Unexpected answer (${res.status}): ${body.error || body.message || 'no details'}` })
    } catch {
      setTest({ kind: 'bad', text: 'Couldn’t reach the drop-box. The function probably isn’t deployed yet.' })
    }
  }

  return (
    <section className="card">
      <h1>Autobot connection</h1>
      <p className="muted">
        Everyone connects their own Autobot above, in <strong>Connect your Autobot</strong>. This section is only for an Autobot that has a direct Supabase
        connection through Composio (needed for the weekly backup), and for testing the screenshot drop-box.
      </p>

      <div className="row wrap gap-s dropbox-test">
        <button className="btn ghost small" onClick={runTest} disabled={!key || test.kind === 'busy'}>
          {test.kind === 'busy' ? 'Testing…' : 'Test screenshot drop-box'}
        </button>
        {key === '' && <span className="muted small">Run update 3 in Supabase first.</span>}
        {test.text && <span className={`small ${test.kind === 'ok' ? 'ok-text' : 'error'}`}>{test.text}</span>}
      </div>

      <details className="setup">
        <summary>Show setup steps</summary>
        <ol className="steps">
          <li>
            In Autobot's Composio, add the <strong>Supabase</strong> toolkit. When Supabase asks which organization to allow, pick{' '}
            <strong>Autobot Feedback</strong>, not Convogenie's Org.
          </li>
          <li>Make sure the action <strong>“Execute project database query”</strong> is enabled.</li>
          <li>
            Add this <strong>one line</strong> to Autobot's built-in instructions, once. It replaces any older, longer instruction you pasted before.
          </li>
        </ol>
        <div className="row between">
          <span className="label">Paste this into Autobot (once)</span>
          <button
            className="btn primary small"
            onClick={() => {
              navigator.clipboard.writeText(STANDING_LINE)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <pre className="reply">{STANDING_LINE}</pre>
        <details className="exact">
          <summary>See the full instruction Autobot reads (for reference, no need to copy)</summary>
          <pre className="reply">{text}</pre>
        </details>
        <div className="row between backup-head">
          <span className="label">Backup routine for Autobot</span>
          <button
            className="btn ghost small"
            onClick={() => {
              navigator.clipboard.writeText(BACKUP_ROUTINE)
              setCopiedBackup(true)
              setTimeout(() => setCopiedBackup(false), 2000)
            }}
          >
            {copiedBackup ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <p className="muted small">Paste this into Autobot and ask it to set it up as a weekly routine. It backs up everything to Google Drive every Monday.</p>
        <pre className="reply">{BACKUP_ROUTINE}</pre>
        <p className="muted small">
          Test it by attaching a screenshot in Autobot and saying: “Log this as feedback: you replied in English even though I asked for Hindi. You should keep
          replying in Hindi.” It should answer with a report number and say the screenshot was attached.
        </p>
      </details>
    </section>
  )
}
