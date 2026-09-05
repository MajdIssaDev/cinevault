import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getWatchLaterByType,
  getWatchLaterItems,
  isInWatchLater,
  removeWatchLater,
  subscribeWatchLater,
  toggleWatchLater,
  type WatchLaterItem,
  type WatchLaterMediaType
} from '../services/watchLaterService'

export function useWatchLater(mediaType?: WatchLaterMediaType): {
  watchLaterItems: WatchLaterItem[]
  isSaved: (id: string | number) => boolean
  toggle: (item: WatchLaterItem) => boolean
  remove: (id: string | number) => void
  refresh: () => void
} {
  const [watchLaterItems, setWatchLaterItems] = useState<WatchLaterItem[]>(() =>
    mediaType ? getWatchLaterByType(mediaType) : getWatchLaterItems()
  )

  const refresh = useCallback((): void => {
    setWatchLaterItems(mediaType ? getWatchLaterByType(mediaType) : getWatchLaterItems())
  }, [mediaType])

  useEffect(() => {
    refresh()
    return subscribeWatchLater(refresh)
  }, [refresh])

  const isSaved = useCallback((id: string | number): boolean => isInWatchLater(id), [watchLaterItems])

  const toggle = useCallback((item: WatchLaterItem): boolean => {
    const next = toggleWatchLater(item)
    refresh()
    return next
  }, [refresh])

  const remove = useCallback(
    (id: string | number): void => {
      removeWatchLater(id)
      refresh()
    },
    [refresh]
  )

  return useMemo(
    () => ({
      watchLaterItems,
      isSaved,
      toggle,
      remove,
      refresh
    }),
    [watchLaterItems, isSaved, toggle, remove, refresh]
  )
}
