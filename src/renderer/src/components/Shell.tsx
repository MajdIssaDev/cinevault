import { NavLink } from 'react-router-dom'
import { useAppStore } from '../store'
import { useEffect, type ReactNode } from 'react'

export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const { lastSession, setSession } = useAppStore()

  useEffect(() => {
    const sync = (): void => {
      try {
        const raw = localStorage.getItem('cinevault-resume')
        if (!raw) return
        const session = JSON.parse(raw)
        useAppStore.setState({ lastSession: session })
        localStorage.removeItem('cinevault-resume')
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('storage', sync)
    sync()
    return () => window.removeEventListener('storage', sync)
  }, [])

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">CineVault</div>
        <div className="spacer" />
        <button type="button" title="Minimize" onClick={() => void window.cinevault?.window.minimize()}>
          ─
        </button>
        <button
          type="button"
          title="Maximize"
          onClick={() => void window.cinevault?.window.toggleMaximize()}
        >
          □
        </button>
        <button type="button" title="Close" onClick={() => void window.cinevault?.window.close()}>
          ×
        </button>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <div className="nav-label">Browse</div>
          <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/movies">
            <span className="label">Movies</span>
          </NavLink>
          <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/series">
            <span className="label">Series</span>
          </NavLink>
          <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/anime">
            <span className="label">Anime</span>
          </NavLink>
          <NavLink
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            to="/favorites"
          >
            <span className="label">Favorites</span>
          </NavLink>
          <div className="nav-label">Library</div>
          <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/library">
            <span className="label">Local & streams</span>
          </NavLink>
          <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/feeds">
            <span className="label">Feeds</span>
          </NavLink>
          <div style={{ flex: 1 }} />
          <NavLink className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} to="/settings">
            <span className="label">Settings</span>
          </NavLink>
        </aside>
        <main className="main-pane">{children}</main>
      </div>
      {lastSession && (
        <div className="resume-chip">
          <span className="muted">Continue · {lastSession.title}</span>
          <button className="btn primary" type="button" onClick={() => setSession(lastSession)}>
            Resume
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => useAppStore.setState({ lastSession: null })}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
