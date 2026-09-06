import type { CatalogItem } from '../types'

/** Build detail route; TMDB-sourced catalog rows use a `tmdb-` id prefix. */
export function detailPathForItem(
  item: Pick<CatalogItem, 'mediaType' | 'externalId' | 'provider'>
): string {
  const idPart = item.provider === 'tmdb' ? `tmdb-${item.externalId}` : String(item.externalId)
  return `/detail/${item.mediaType}/${idPart}`
}

export function parseDetailIdParam(id: string | undefined): {
  externalId: number
  fromTmdb: boolean
} {
  const raw = id || '0'
  const fromTmdb = raw.startsWith('tmdb-')
  const externalId = Number(fromTmdb ? raw.slice(5) : raw)
  return { externalId, fromTmdb }
}
