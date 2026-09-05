import { useEffect } from 'react'
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

export default function App(): JSX.Element {
  const loadSettings = useAppStore((s) => s.loadSettings)
  const settings = useAppStore((s) => s.settings)
  const session = useAppStore((s) => s.session)
  const location = useLocation()

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

  // Catalog = portrait · Player = landscape (native only)
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
        <Routes>
          <Route path="/" element={<Navigate to="/movies" replace />} />
          <Route path="/movies" element={<CatalogPage mediaType="movie" />} />
          <Route path="/series" element={<CatalogPage mediaType="series" />} />
          <Route path="/anime" element={<CatalogPage mediaType="anime" />} />
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
