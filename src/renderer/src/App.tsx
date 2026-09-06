import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAppStore } from './store'
import { Shell } from './components/Shell'
import { CatalogPage } from './pages/CatalogPage'
import { DetailPage } from './pages/DetailPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { SettingsPage } from './pages/SettingsPage'
import { LibraryPage } from './pages/LibraryPage'
import { FeedPage } from './pages/FeedPage'
import { PlayerPage } from './pages/PlayerPage'
import { PipPage } from './pages/PipPage'
import { syncTitleBarOverlay } from './lib/titlebarOverlay'
import { initMobileOta } from './lib/mobileOta'
import { lockCatalogOrientation, lockPlayerOrientation } from './lib/mobileOrientation'
import { isMobileShell } from './lib/platform'
import { TitleBar } from './components/TitleBar'
import type { MediaType } from './types'

const CATALOG_TABS: MediaType[] = ['movie', 'series', 'anime']

function catalogMediaFromPath(pathname: string): MediaType | null {
  if (pathname === '/movies') return 'movie'
  if (pathname === '/series') return 'series'
  if (pathname === '/anime') return 'anime'
  return null
}

export default function App(): JSX.Element {
  const loadSettings = useAppStore((s) => s.loadSettings)
  const settings = useAppStore((s) => s.settings)
  const session = useAppStore((s) => s.session)
  const location = useLocation()
  const routeCatalog = catalogMediaFromPath(location.pathname)
  const onDetail = location.pathname.startsWith('/detail/')
  const [keptCatalog, setKeptCatalog] = useState<MediaType>('movie')
  const [visitedTabs, setVisitedTabs] = useState<MediaType[]>(() =>
    routeCatalog ? [routeCatalog] : ['movie']
  )

  // Register the tab during render so the panel exists on the same commit (no blank frame).
  if (routeCatalog && !visitedTabs.includes(routeCatalog)) {
    setVisitedTabs([...visitedTabs, routeCatalog])
  }

  useEffect(() => {
    if (routeCatalog) setKeptCatalog(routeCatalog)
  }, [routeCatalog])

  const catalogType = routeCatalog ?? keptCatalog
  const catalogVisible = routeCatalog != null
  const catalogMounted = catalogVisible || onDetail

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (isMobileShell()) {
      document.documentElement.classList.add('is-mobile-shell')
      void initMobileOta()
    }
  }, [])

  useEffect(() => {
    syncTitleBarOverlay(Boolean(session))
  }, [session, settings?.theme])

  useEffect(() => {
    document.documentElement.classList.toggle('player-open', Boolean(session))
    return () => document.documentElement.classList.remove('player-open')
  }, [session])

  useEffect(() => {
    if (!isMobileShell()) return
    if (session) void lockPlayerOrientation()
    else void lockCatalogOrientation()
  }, [session])

  useEffect(() => {
    const updater = window.cinevault?.updater
    if (!updater) return
    return updater.onStatus((payload) => {
      if (payload.status === 'available' || payload.status === 'ready') {
        useAppStore.getState().setUpdateBadge(true, payload.version ?? null)
      } else if (payload.status === 'none') {
        useAppStore.getState().setUpdateBadge(false, null)
      }
    })
  }, [])

  if (location.pathname === '/pip' || location.hash === '#/pip') {
    return <PipPage />
  }

  return (
    <>
      <TitleBar />
      <Shell>
        {catalogMounted && (
          <div className="catalog-keepalive" hidden={!catalogVisible} aria-hidden={!catalogVisible}>
            {CATALOG_TABS.map((type) =>
              visitedTabs.includes(type) ? (
                <div
                  key={type}
                  className={`catalog-tab-panel${catalogType === type ? ' is-active' : ' is-inactive'}`}
                  aria-hidden={catalogType !== type}
                >
                  <CatalogPage mediaType={type} active={catalogType === type && catalogVisible} />
                </div>
              ) : null
            )}
          </div>
        )}
        <Routes>
          <Route path="/" element={<Navigate to="/movies" replace />} />
          <Route path="/movies" element={null} />
          <Route path="/series" element={null} />
          <Route path="/anime" element={null} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/feeds" element={<FeedPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/detail/:mediaType/:id" element={<DetailPage />} />
          <Route path="/pip" element={<PipPage />} />
        </Routes>
      </Shell>
      {session && <PlayerPage />}
    </>
  )
}
