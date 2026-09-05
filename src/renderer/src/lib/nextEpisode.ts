/**
 * Resolve the next episode after the currently playing one.
 */
import type { EpisodeInfo, MediaType, SeasonInfo } from '../types'
import { fetchAnimeDetails } from '../api/anilist'
import { fetchSeriesDetails } from '../api/tvmaze'

export type NextEpisodeTarget = {
  season: number
  episode: number
  episodeTitle: string
  showTitle: string
  posterUrl: string | null
  backdropUrl: string | null
  imdbId: string | null
  seasons: SeasonInfo[]
  episodes: EpisodeInfo[]
}

export async function resolveNextEpisode(opts: {
  mediaType: MediaType
  externalId: number
  season?: number
  episode?: number
}): Promise<NextEpisodeTarget | null> {
  if (opts.mediaType === 'movie') return null
  const season = opts.season ?? 1
  const episode = opts.episode ?? 1

  if (opts.mediaType === 'anime') {
    const data = await fetchAnimeDetails(opts.externalId)
    const next = data.episodes.find(
      (e) => e.seasonNumber === season && e.episodeNumber === episode + 1
    )
    if (!next) return null
    return {
      season: next.seasonNumber,
      episode: next.episodeNumber,
      episodeTitle: next.title,
      showTitle: data.item.title,
      posterUrl: data.item.posterUrl,
      backdropUrl: data.item.backdropUrl,
      imdbId: data.item.imdbId || null,
      seasons: data.seasons,
      episodes: data.episodes
    }
  }

  const data = await fetchSeriesDetails(opts.externalId)
  const sorted = [...data.episodes].sort((a, b) =>
    a.seasonNumber !== b.seasonNumber
      ? a.seasonNumber - b.seasonNumber
      : a.episodeNumber - b.episodeNumber
  )

  const idx = sorted.findIndex(
    (e) => e.seasonNumber === season && e.episodeNumber === episode
  )
  if (idx < 0) return null
  const next = sorted[idx + 1]
  if (!next) return null

  return {
    season: next.seasonNumber,
    episode: next.episodeNumber,
    episodeTitle: next.title,
    showTitle: data.item.title,
    posterUrl: data.item.posterUrl,
    backdropUrl: data.item.backdropUrl,
    imdbId: data.imdbId,
    seasons: data.seasons,
    episodes: data.episodes
  }
}
