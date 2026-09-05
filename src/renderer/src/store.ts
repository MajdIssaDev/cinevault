import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppSettings } from '../../../main/settings'
import type { FavoriteEntry, PlaybackSession, Quality } from '../types'
import { syncTitleBarOverlay } from './lib/titlebarOverlay'

interface AppState {
  settings: AppSettings | null
  favorites: FavoriteEntry[]
  session: PlaybackSession | null
  lastSession: PlaybackSession | null
  searchQuery: string
  genreFilter: string
  sortBy: 'popularity' | 'rating' | 'date' | 'title'
  qualityPref: Quality
  updateAvailable: boolean
  updateVersion: string | null
  loadSettings: () => Promise<void>
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>
  toggleFavorite: (entry: FavoriteEntry) => void
  setSession: (session: PlaybackSession | null) => void
  stashLastSession: () => void
  setSearchQuery: (q: string) => void
  setGenreFilter: (g: string) => void
  setSortBy: (s: AppState['sortBy']) => void
  setQualityPref: (q: Quality) => void
  setUpdateBadge: (available: boolean, version?: string | null) => void
}

const fallbackSettings = async (): Promise<AppSettings> => {
  if (window.cinevault) return window.cinevault.settings.get()
  return {
    theme: 'dark',
    tmdbApiKey: '',
    subdlApiKey: '',
    openSubtitlesApiKey: '',
    openSubtitlesUsername: '',
    openSubtitlesPassword: '',
    defaultSubtitleLanguage: 'en',
    defaultQuality: '1080p',
    libraryFolders: [],
    cacheDirectory: '',
    cacheRetentionHours: 48,
    autoDeleteOnComplete: true,
    preferHdr: true,
    preferSpatialAudio: true,
    updateChannel: 'latest'
  }
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      settings: null,
      favorites: [],
      session: null,
      lastSession: null,
      searchQuery: '',
      genreFilter: 'all',
      sortBy: 'popularity',
      qualityPref: '1080p',
      updateAvailable: false,
      updateVersion: null,
      loadSettings: async () => {
        const settings = await fallbackSettings()
        set({ settings, qualityPref: settings.defaultQuality })
        document.documentElement.dataset.theme =
          settings.theme === 'system'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
            : settings.theme
        syncTitleBarOverlay(Boolean(get().session))
      },
      saveSettings: async (partial) => {
        if (!window.cinevault) return
        const settings = await window.cinevault.settings.set(partial)
        set({ settings })
        document.documentElement.dataset.theme =
          settings.theme === 'system'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
            : settings.theme
        syncTitleBarOverlay(Boolean(get().session))
      },
      toggleFavorite: (entry) => {
        const exists = get().favorites.some(
          (f) => f.mediaType === entry.mediaType && f.externalId === entry.externalId
        )
        set({
          favorites: exists
            ? get().favorites.filter(
                (f) => !(f.mediaType === entry.mediaType && f.externalId === entry.externalId)
              )
            : [...get().favorites, entry]
        })
      },
      setSession: (session) => set({ session }),
      stashLastSession: () => {
        const { session } = get()
        if (session) set({ lastSession: session, session: null })
      },
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setGenreFilter: (genreFilter) => set({ genreFilter }),
      setSortBy: (sortBy) => set({ sortBy }),
      setQualityPref: (qualityPref) => set({ qualityPref }),
      setUpdateBadge: (available, version = null) =>
        set({ updateAvailable: available, updateVersion: version ?? null })
    }),
    {
      name: 'cinevault-ui',
      version: 2,
      migrate: (persisted) => {
        if (persisted && typeof persisted === 'object' && 'lastSession' in persisted) {
          const { lastSession: _drop, ...rest } = persisted as Record<string, unknown>
          return rest as typeof persisted
        }
        return persisted
      },
      partialize: (s) => ({
        favorites: s.favorites,
        sortBy: s.sortBy,
        genreFilter: s.genreFilter,
        qualityPref: s.qualityPref
      })
    }
  )
)
