import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppSettings } from '../../../main/settings'
import type { FavoriteEntry, PlaybackSession, Quality } from '../types'

interface AppState {
  settings: AppSettings | null
  favorites: FavoriteEntry[]
  session: PlaybackSession | null
  lastSession: PlaybackSession | null
  searchQuery: string
  genreFilter: string
  sortBy: 'popularity' | 'rating' | 'date' | 'title'
  qualityPref: Quality
  loadSettings: () => Promise<void>
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>
  toggleFavorite: (entry: FavoriteEntry) => void
  isFavorite: (mediaType: string, externalId: number) => boolean
  setSession: (session: PlaybackSession | null) => void
  stashLastSession: () => void
  setSearchQuery: (q: string) => void
  setGenreFilter: (g: string) => void
  setSortBy: (s: AppState['sortBy']) => void
  setQualityPref: (q: Quality) => void
}

const fallbackSettings = async (): Promise<AppSettings> => {
  if (window.cinevault) return window.cinevault.settings.get()
  return {
    theme: 'dark',
    tmdbApiKey: '',
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
    updateChannel: 'latest',
    torznabEndpoint: '',
    torznabApiKey: ''
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
      loadSettings: async () => {
        const settings = await fallbackSettings()
        set({ settings, qualityPref: settings.defaultQuality })
        document.documentElement.dataset.theme =
          settings.theme === 'system'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
            : settings.theme
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
      isFavorite: (mediaType, externalId) =>
        get().favorites.some((f) => f.mediaType === mediaType && f.externalId === externalId),
      setSession: (session) => set({ session }),
      stashLastSession: () => {
        const { session } = get()
        if (session) set({ lastSession: session, session: null })
      },
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setGenreFilter: (genreFilter) => set({ genreFilter }),
      setSortBy: (sortBy) => set({ sortBy }),
      setQualityPref: (qualityPref) => set({ qualityPref })
    }),
    {
      name: 'cinevault-ui',
      partialize: (s) => ({
        favorites: s.favorites,
        lastSession: s.lastSession,
        sortBy: s.sortBy,
        genreFilter: s.genreFilter,
        qualityPref: s.qualityPref
      })
    }
  )
)
