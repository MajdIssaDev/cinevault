import { useCallback, useEffect, useState } from 'react'
import {
  isInWatchLater,
  subscribeWatchLater,
  toggleWatchLater,
  type WatchLaterItem
} from '../services/watchLaterService'

/**
 * Per-id Watch Later flag — avoids holding the full list in every poster card.
 * Only commits state when the boolean actually changes.
 */
export function useWatchLaterFlag(id: string | number): {
  saved: boolean
  toggle: (item: WatchLaterItem) => boolean
} {
  const [saved, setSaved] = useState(() => isInWatchLater(id))

  useEffect(() => {
    const sync = (): void => {
      const next = isInWatchLater(id)
      setSaved((prev) => (prev === next ? prev : next))
    }
    sync()
    return subscribeWatchLater(sync)
  }, [id])

  const toggle = useCallback((item: WatchLaterItem): boolean => {
    const next = toggleWatchLater(item)
    setSaved(next)
    return next
  }, [])

  return { saved, toggle }
}
