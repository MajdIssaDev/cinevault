import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Measures overflow on demand and slides the title to its end on hover,
 * then eases back. Prefer passing `active` from the parent card so hover
 * anywhere on the card triggers the scroll.
 */
export function HoverScrollTitle({
  title,
  className = '',
  active
}: {
  title: string
  className?: string
  /** When set, scroll is driven by the parent card hover instead of the title alone. */
  active?: boolean
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [offset, setOffset] = useState(0)

  const measureAndScroll = (): number => {
    const container = containerRef.current
    const text = textRef.current
    if (!container || !text) return 0

    // Intrinsic text width (unconstrained)
    const prevMax = text.style.maxWidth
    const prevWhiteSpace = text.style.whiteSpace
    text.style.maxWidth = 'none'
    text.style.whiteSpace = 'nowrap'
    const scrollW = Math.ceil(text.scrollWidth)
    text.style.maxWidth = prevMax
    text.style.whiteSpace = prevWhiteSpace

    // Clip width: prefer card ancestor so we don't shrink-wrap to the text
    let clipEl: HTMLElement | null = container
    let cardW = 0
    while (clipEl) {
      const cls = clipEl.className?.toString?.() ?? ''
      if (/\b(watch-later-card|continue-card|poster-card)\b/.test(cls)) {
        cardW = Math.floor(clipEl.clientWidth)
        break
      }
      clipEl = clipEl.parentElement
    }
    const parentW = container.parentElement?.clientWidth ?? 0
    const containerW = container.clientWidth
    const clientW = Math.max(0, cardW || parentW || containerW)
    const diff = scrollW - clientW
    const next = diff > 0 ? diff + 6 : 0
    setOffset(next)
    return next
  }

  const reset = (): void => {
    setOffset(0)
  }

  useEffect(() => {
    if (active === undefined) return
    if (active) measureAndScroll()
    else reset()
  }, [active, title])

  useLayoutEffect(() => {
    if (!active) return
    // Re-measure after paint in case fonts/layout settle late
    measureAndScroll()
  }, [active, title])

  const scrolling = offset > 0
  // ~55px/s — between the old ~30px/s crawl and the snappy ~90px/s pass
  const duration = scrolling ? Math.min(2.8, Math.max(0.85, offset / 55)) : 0.32
  const maskClass =
    scrolling || active ? (offset > 0 ? ' is-overflow-start' : ' is-overflow-end') : ''

  return (
    <div
      ref={containerRef}
      className={`hover-scroll-title${scrolling ? ' is-scrolling' : ''}${maskClass}`}
      onMouseEnter={active === undefined ? measureAndScroll : undefined}
      onMouseLeave={active === undefined ? reset : undefined}
    >
      <span
        ref={textRef}
        className={`hover-scroll-title-text${className ? ` ${className}` : ''}`}
        style={{
          transform: `translateX(-${offset}px)`,
          transition: `transform ${duration}s ${scrolling ? 'ease-in-out' : 'ease-out'}`
        }}
      >
        {title}
      </span>
    </div>
  )
}
