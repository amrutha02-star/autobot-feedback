import { useState } from 'react'
import { canRemember, supabase } from '../lib'
import { Logo, PasswordInput } from '../components'

type Mode = 'password' | 'link'

function friendly(message: string) {
  const m = message.toLowerCase()
  if (m.includes('rate limit'))
    return 'Too many sign-in emails were sent in the last hour (Supabase’s free plan allows only a few). Wait about an hour, or sign in with your password.'
  if (m.includes('invalid login credentials'))
    return 'Wrong email or password. If you haven’t set a password yet, use “Email me a link” once, then set one from the menu under your initial.'
  if (m.includes('email not confirmed')) return 'This email hasn’t been confirmed yet. Use “Email me a link” to sign in the first time.'
  return message
}

export default function Login() {
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } =
      mode === 'password'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
    setBusy(false)
    if (error) setError(friendly(error.message))
    else if (mode === 'link') setSent(true)
  }

  return (
    <div className="login">
      <div className="card login-card">
        <Logo size={40} />
        <h1>Autobot Feedback</h1>
        <p className="muted">Report what Autobot got wrong, track the fix, and retest it.</p>
        {!canRemember && (
          <p className="warn">
            Your browser is blocking this site from remembering you, so you'll have to sign in every time. In Brave, click the lion icon in the address bar
            and allow cookies for this site. Also turn off "Forget me when I close this site".
          </p>
        )}

        {sent ? (
          <>
            <p className="notice">
              Check <strong>{email}</strong> for a sign-in link. Open it in <strong>this same browser</strong>. Once you're in, set a password from the menu
              under your initial (top right), so next time you won't need an email.
            </p>
            <button className="btn ghost wide" onClick={() => setSent(false)}>Back</button>
          </>
        ) : (
          <>
            <div className="tabs small" role="tablist">
              <button type="button" className={mode === 'password' ? 'on' : ''} onClick={() => { setMode('password'); setError('') }}>
                Password
              </button>
              <button type="button" className={mode === 'link' ? 'on' : ''} onClick={() => { setMode('link'); setError('') }}>
                Email me a link
              </button>
            </div>
            <form onSubmit={submit}>
              <label>
                Work email
                <input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </label>
              {mode === 'password' && (
                <label>
                  Password
                  <PasswordInput
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              )}
              {error && <p className="error">{error}</p>}
              <button className="btn primary wide" disabled={busy}>
                {busy ? 'Please wait…' : mode === 'password' ? 'Sign in' : 'Email me a sign-in link'}
              </button>
              {mode === 'password' && (
                <p className="muted small">
                  First time here? Choose <strong>Email me a link</strong>, then set a password once you're in.
                </p>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  )
}
