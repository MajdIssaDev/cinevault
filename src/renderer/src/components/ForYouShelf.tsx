import { useEffect, useState } from 'react'
import type { CatalogItem, MediaType } from '../types'
import { useAppStore } from '../store'
import { fetchForYouRecommendations, resolveTmdbApiKey } from '../api/tmdb'
import {
  LocalAffinityEngine,
  toAffinityType
} from '../services/recommendationEngine'
import { HScrollRail } from './HScrollRail'
import { PosterCard } from './PosterCard'

export function ForYouShelf({ mediaType }: { mediaType: MediaType }): JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const apiKey = resolveTmdbApiKey(settings?.tmdbApiKey)
    if (!apiKey) {
      setItems([])
      setLoading(false)
      return
    }

    setLoading(true)
    const affinityType = toAffinityType(mediaType)
    const topGenres = LocalAffinityEngine.getTopAffinityGenres(affinityType)
    const excluded = LocalAffinityEngine.getExcludedIds(affinityType)

    void fetchForYouRecommendations(apiKey, mediaType, topGenres, excluded)
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [mediaType, settings?.tmdbApiKey])

  if (loading && items.length === 0) return null
  if (!items.length) return null

  return (
    <section className="for-you-shelf catalog-shelf" aria-label="For You">
      <div className="catalog-shelf-head for-you-shelf-head">
        <h2 className="catalog-shelf-title">For You</h2>
      </div>
      <HScrollRail trackClassName="catalog-shelf-track for-you-track">
        {items.map((item) => (
          <div key={item.id} className="shelf-card-slot for-you-card-slot">
            <PosterCard item={item} />
          </div>
        ))}
      </HScrollRail>
    </section>
  )
}
