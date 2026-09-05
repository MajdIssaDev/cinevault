import { NavLink, useLocation } from 'react-router-dom'
import { useAppStore } from '../store'
import { useEffect, type ReactNode } from 'react'

const TOP_LINKS = [
  { to: '/movies', label: 'Movies' },
  { to: '/series', label: 'Series' },
  { to: '/anime', label: 'Anime' },
  { to: '/feeds', label: 'Feeds' },
  { to: '/library', label: 'Local & streams' },
  { to: '/favorites', label: 'Favorites' }
] as const

export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const setGenreFilter = useAppStore((s) => s.setGenreFilter)
  const location = useLocation()

  const catalogType =
    location.pathname.startsWith('/movies')
      ? 'movie'
      : location.pathname.startsWith('/series')
        ? 'series'
        : location.pathname.startsWith('/anime')
          ? 'anime'
          : null

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

  useEffect(() => {
    setGenreFilter('all')
  }, [catalogType, setGenreFilter])

  useEffect(() => {
    const pane = document.querySelector('.main-pane')
    if (pane) pane.scrollTop = 0
  }, [location.pathname])

  return (
    <div className="app-shell">
      <div className="app-atmosphere" aria-hidden="true">
        <span className="glow-bubble b1" />
        <span className="glow-bubble b2" />
        <span className="glow-bubble b3" />
        <span className="glow-bubble b4" />
      </div>

      <nav className="top-nav" aria-label="Primary">
        {TOP_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => `top-nav-item${isActive ? ' active' : ''}`}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <div className="app-body app-body-full">
        <main className="main-pane">{children}</main>
      </div>
    </div>
  )
}
