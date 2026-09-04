import type { CatalogItem, EpisodeInfo, SeasonInfo } from '../types'

const ENDPOINT = 'https://graphql.anilist.co'

async function anilist<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  if (!res.ok) throw new Error(`AniList ${res.status}`)
  const json = (await res.json()) as { data: T; errors?: { message: string }[] }
  if (json.errors?.length) throw new Error(json.errors[0].message)
  return json.data
}

function mapAnime(m: {
  id: number
  title: { romaji: string; english: string | null }
  description: string | null
  coverImage: { large: string | null }
  bannerImage: string | null
  startDate: { year: number | null; month: number | null; day: number | null }
  averageScore: number | null
  genres: string[]
}): CatalogItem {
  const d = m.startDate
  const releaseDate =
    d.year != null
      ? `${d.year}-${String(d.month || 1).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}`
      : null
  return {
    id: `anime-${m.id}`,
    externalId: m.id,
    mediaType: 'anime',
    title: m.title.english || m.title.romaji,
    overview: (m.description || '').replace(/<[^>]+>/g, ''),
    posterUrl: m.coverImage.large,
    backdropUrl: m.bannerImage,
    releaseDate,
    rating: m.averageScore ? m.averageScore / 10 : 0,
    genres: m.genres || []
  }
}

const MEDIA_FIELDS = `
  id
  title { romaji english }
  description
  coverImage { large }
  bannerImage
  startDate { year month day }
  averageScore
  genres
`

export async function fetchPopularAnime(page = 1): Promise<CatalogItem[]> {
  const data = await anilist<{
    Page: { media: Parameters<typeof mapAnime>[0][] }
  }>(
    `query ($page: Int) {
      Page(page: $page, perPage: 24) {
        media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${MEDIA_FIELDS} }
      }
    }`,
    { page }
  )
  return data.Page.media.map(mapAnime)
}

export async function searchAnime(query: string): Promise<CatalogItem[]> {
  const data = await anilist<{
    Page: { media: Parameters<typeof mapAnime>[0][] }
  }>(
    `query ($q: String) {
      Page(page: 1, perPage: 24) {
        media(type: ANIME, search: $q, isAdult: false, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
      }
    }`,
    { q: query }
  )
  return data.Page.media.map(mapAnime)
}

export async function fetchAnimeDetails(id: number): Promise<{
  item: CatalogItem
  seasons: SeasonInfo[]
  episodes: EpisodeInfo[]
}> {
  const data = await anilist<{
    Media: Parameters<typeof mapAnime>[0] & {
      episodes: number | null
      streamingEpisodes: { title: string; thumbnail: string }[]
    }
  }>(
    `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FIELDS}
        episodes
        streamingEpisodes { title thumbnail }
      }
    }`,
    { id }
  )

  const item = mapAnime(data.Media)
  const count = data.Media.episodes || data.Media.streamingEpisodes?.length || 12
  const seasons: SeasonInfo[] = [
    { seasonNumber: 1, name: 'Season 1', episodeCount: count, posterUrl: item.posterUrl }
  ]

  const episodes: EpisodeInfo[] = Array.from({ length: count }, (_, i) => {
    const stream = data.Media.streamingEpisodes?.[i]
    return {
      id: `anime-ep-${id}-${i + 1}`,
      seasonNumber: 1,
      episodeNumber: i + 1,
      title: stream?.title || `Episode ${i + 1}`,
      overview: stream?.title || `Episode ${i + 1} of ${item.title}`,
      stillUrl: stream?.thumbnail || item.posterUrl
    }
  })

  return { item, seasons, episodes }
}

export async function fetchAnimeByGenre(genre: string, page = 1): Promise<CatalogItem[]> {
  const data = await anilist<{
    Page: { media: Parameters<typeof mapAnime>[0][] }
  }>(
    `query ($page: Int, $genre: String) {
      Page(page: $page, perPage: 24) {
        media(type: ANIME, genre: $genre, sort: POPULARITY_DESC, isAdult: false) { ${MEDIA_FIELDS} }
      }
    }`,
    { page, genre }
  )
  return data.Page.media.map(mapAnime)
}
