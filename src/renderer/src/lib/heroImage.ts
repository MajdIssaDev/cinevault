const TMDB_ORIGINAL = 'https://image.tmdb.org/t/p/original'

/** Prefer a true landscape backdrop; never stretch a portrait poster into the hero. */
export function resolveHeroBackdropUrl(
  backdropUrl: string | null | undefined,
  _posterUrl?: string | null
): string | null {
  if (!backdropUrl) return null
  return upgradeImageUrl(backdropUrl)
}

/**
 * YTS “background” art is often soft-focus. Prefer sharp large screenshots when present,
 * then an upgraded backdrop URL.
 */
export function pickSharpHeroUrl(
  backdropUrl: string | null | undefined,
  stills?: string[] | null
): string | null {
  const sharp =
    stills?.find((u) => /large[-_]?screenshot|\/(?:original|w1280|w1920)\//i.test(u)) ||
    stills?.find((u) => !/medium[-_]?screenshot|\/w\d{2,3}\//i.test(u)) ||
    stills?.[0]
  if (sharp) return upgradeImageUrl(sharp)
  return resolveHeroBackdropUrl(backdropUrl)
}

/**
 * Force TMDB paths to `/t/p/original` — never leave w780 / w1280 / etc. for hero art.
 * Also bumps YTS background / screenshot tokens to max quality.
 */
export function upgradeImageUrl(url: string): string {
  // Absolute or protocol-relative TMDB CDN
  let next = url.replace(
    /(?:https?:)?\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|h\d+|original)(?=\/|$)/i,
    TMDB_ORIGINAL
  )
  // Path-only / relative size tokens
  next = next.replace(/\/t\/p\/(?:w\d+|h\d+)(?=\/|$)/i, '/t/p/original')
  // File path fragment like `/abc.jpg` already at original host with wrong size mid-URL
  next = next.replace(
    /(image\.tmdb\.org\/t\/p\/)(?:w\d+|h\d+)/i,
    `$1original`
  )
  next = next
    .replace(/\/background_image(?!_original)/i, '/background_image_original')
    .replace(/medium-screenshot/gi, 'large-screenshot')
    .replace(/medium_screenshot/gi, 'large_screenshot')
  return next
}

/** Build a TMDB original backdrop URL from a bare `backdrop_path` (`/xyz.jpg`). */
export function tmdbOriginalBackdropUrl(
  backdropPath: string | null | undefined
): string | null {
  if (!backdropPath) return null
  const path = backdropPath.startsWith('/') ? backdropPath : `/${backdropPath}`
  return `${TMDB_ORIGINAL}${path}`
}
