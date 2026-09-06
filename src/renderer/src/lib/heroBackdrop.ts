import { tmdbOriginalBackdropUrl } from './heroImage'

export interface TMDBBackdrop {
  file_path: string
  width: number
  height: number
  aspect_ratio: number
  vote_average: number
  vote_count: number
  iso_639_1: string | null
}

function scoreBackdrop(img: TMDBBackdrop): number {
  return (img.vote_average || 0) * Math.log10((img.vote_count || 0) + 1)
}

function rankBackdrops(pool: TMDBBackdrop[]): TMDBBackdrop[] {
  return [...pool].sort((a, b) => scoreBackdrop(b) - scoreBackdrop(a))
}

/**
 * Pick the best scenic hero backdrop: prefer textless 16:9 ≥1920px,
 * scored by vote_average × log10(vote_count+1).
 */
export function selectOptimalHeroBackdrop(
  backdrops: TMDBBackdrop[],
  fallbackPath?: string | null
): string {
  if (!backdrops?.length) {
    return tmdbOriginalBackdropUrl(fallbackPath) || ''
  }

  // 1. Strict: textless near-16:9 at least 1080p/4K-class width
  const strict = backdrops.filter(
    (img) =>
      img.width >= 1920 &&
      img.aspect_ratio >= 1.7 &&
      img.aspect_ratio <= 1.85 &&
      img.iso_639_1 == null
  )

  // 2. Soft: textless widescreen
  const textlessWide = backdrops.filter(
    (img) => img.iso_639_1 == null && img.aspect_ratio >= 1.6 && img.width >= 1280
  )

  // 3. Any textless
  const textless = backdrops.filter((img) => img.iso_639_1 == null)

  const pool =
    strict.length > 0
      ? strict
      : textlessWide.length > 0
        ? textlessWide
        : textless.length > 0
          ? textless
          : backdrops

  const chosen = rankBackdrops(pool)[0] || backdrops[0]
  if (!chosen?.file_path) {
    return tmdbOriginalBackdropUrl(fallbackPath) || ''
  }
  return tmdbOriginalBackdropUrl(chosen.file_path) || ''
}
