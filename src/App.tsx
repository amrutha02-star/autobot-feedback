import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { demo, supabase, useLiveStatus, useRoute, type Me } from './lib'
import Login from './pages/Login'
import Reports from './pages/Reports'
import NewReport from './pages/NewReport'
import ReportDetail from './pages/ReportDetail'
import Settings from './pages/Settings'
import { Logo, NotificationBell, UserMenu } from './components'
import { useNotifications } from './notifications'

export default function App() {
  const route = useRoute()
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [me, setMe] = useState<(Me & { allowed: boolean }) | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return setMe(null)
    supabase
      .from('team')
      .select('*')
      .ilike('email', session.user.email || '')
      .maybeSingle()
      .then(({ data }) =>
        setMe({
          name: data?.name || session.user.email || 'Me',
          email: session.user.email || '',
          admin: Boolean(data?.is_admin),
          role: data?.role === 'fixer' ? 'fixer' : 'reporter',
          allowed: Boolean(data),
        }),
      )
  }, [session])

  if (session === undefined) return null
  if (!session) return <Login />
  if (!me) return null
  if (!me.allowed)
    return (
      <div className="login">
        <div className="card login-card">
          <h1>No access</h1>
          <p className="muted">
            You’re signed in as <strong>{session.user.email}</strong>, but this email hasn’t been given access yet. Ask the admin to add it, then refresh this page.
          </p>
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    )

  return <Shell me={me} route={route} />
}

/** Everything after sign-in. Separate so the notifications hook only runs for signed-in team members. */
function Shell({ me, route }: { me: Me; route: string }) {
  const notifications = useNotifications(me)
  const detail = route.match(/^\/r\/(\d+)/)
  return (
    <>
      {demo && (
        <div className="demo-bar">
          Demo mode: sample data, nothing is saved. Add Supabase keys to <code>.env</code> to go live.
        </div>
      )}
      <nav className="nav">
        <a href="#/" className="brand">
          <Logo size={24} />
          <span>Autobot <b>Feedback</b></span>
        </a>
        <div className="row">
          <LiveDot />
          <a href="#/new" className="btn primary">+ Report issue</a>
          <NotificationBell notices={notifications.notices} onMarkAll={notifications.markAllRead} />
          <UserMenu name={me.name} email={me.email} />
        </div>
      </nav>
      <main className="main">
        {route === '/new' ? (
          <NewReport me={me} />
        ) : route === '/settings' ? (
          <Settings myEmail={me.email} admin={me.admin} />
        ) : detail ? (
          <ReportDetail key={detail[1]} number={Number(detail[1])} me={me} />
        ) : (
          <Reports me={me} unreadIds={notifications.unreadReportIds} />
        )}
      </main>
    </>
  )
}

function LiveDot() {
  const st = useLiveStatus()
  const label = { live: 'Live: updates appear instantly', connecting: 'Connecting to live updates…', error: 'Live updates not connected (the bell still checks every minute)' }[st]
  return (
    <span className={`live-dot live-${st}`} title={label} aria-label={label}>
      <i /> {st === 'live' ? 'Live' : st === 'error' ? 'Offline' : '…'}
    </span>
  )
}
