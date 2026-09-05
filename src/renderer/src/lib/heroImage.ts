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

/** Bump TMDB / YTS size tokens up to original / max quality. */
export function upgradeImageUrl(url: string): string {
  return url
    .replace(
      /image\.tmdb\.org\/t\/p\/(?:w\d+|h\d+|original)/i,
      'image.tmdb.org/t/p/original'
    )
    .replace(/\/background_image(?!_original)/i, '/background_image_original')
    .replace(/medium-screenshot/gi, 'large-screenshot')
    .replace(/medium_screenshot/gi, 'large_screenshot')
}
