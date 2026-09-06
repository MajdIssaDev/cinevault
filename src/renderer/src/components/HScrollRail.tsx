import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const SCROLL_STEP = 320
const EDGE_EPS = 5

/** Horizontal scroller with edge chevrons, hidden scrollbar, wheel→horizontal. */
export function HScrollRail({
  children,
  className = '',
  trackClassName = '',
  'aria-label': ariaLabel,
  role = 'list'
}: {
  children: ReactNode
  className?: string
  trackClassName?: string
  'aria-label'?: string
  role?: string
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const updateEdges = useCallback((): void => {
    const el = ref.current
    if (!el) {
      setCanLeft(false)
      setCanRight(false)
      return
    }
    const { scrollLeft, clientWidth, scrollWidth } = el
    // No overflow → no edge fades / chevrons (e.g. Continue Watching with ≤2 cards).
    if (scrollWidth <= clientWidth + EDGE_EPS) {
      setCanLeft(false)
      setCanRight(false)
      return
    }
    setCanLeft(scrollLeft > EDGE_EPS)
    setCanRight(scrollLeft < scrollWidth - clientWidth - EDGE_EPS)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Keep an authoritative target so rapid wheel ticks don't fight a mid-flight position.
    let targetLeft = el.scrollLeft

    const onWheel = (e: WheelEvent): void => {
      // Only hijack vertical wheel when the rail actually overflows.
      if (el.scrollWidth <= el.clientWidth + EDGE_EPS) return
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!dx) return
      e.preventDefault()
      const max = Math.max(0, el.scrollWidth - el.clientWidth)
      const before = el.scrollLeft
      // If user scrubbed via drag/chevrons, resync target to the live position.
      if (Math.abs(targetLeft - before) > 1) targetLeft = before
      targetLeft = Math.max(0, Math.min(max, targetLeft + dx))
      // Force instant apply — CSS smooth makes scrollLeft writes no-ops and stacks animations.
      el.style.scrollBehavior = 'auto'
      el.scrollLeft = targetLeft
      updateEdges()
    }

    const onScroll = (): void => {
      // Chevrons use smooth scrollBy — follow the live position when not mid-wheel burst.
      targetLeft = el.scrollLeft
      updateEdges()
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', onScroll, { passive: true })

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateEdges) : null
    ro?.observe(el)

    updateEdges()
    const t = window.setTimeout(updateEdges, 50)
    // Re-check after layout/fonts settle (card widths animate in).
    const t2 = window.setTimeout(updateEdges, 320)

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', onScroll)
      ro?.disconnect()
      window.clearTimeout(t)
      window.clearTimeout(t2)
    }
  }, [updateEdges, children])

  const scrollByDir = (direction: -1 | 1): void => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: direction * SCROLL_STEP, behavior: 'smooth' })
  }

  const fadeClass = `${canLeft ? ' fade-left' : ''}${canRight ? ' fade-right' : ''}`

  return (
    <div
      className={`hscroll-shell${canLeft ? ' has-left' : ''}${canRight ? ' has-right' : ''}${className ? ` ${className}` : ''}`}
    >
      <div className="hscroll-gutter left">
        {canLeft && (
          <button
            type="button"
            className="hscroll-nav"
            aria-label="Scroll left"
            onClick={() => scrollByDir(-1)}
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className={`hscroll-wrap${fadeClass}`}>
        <div
          ref={ref}
          className={`hscroll-track${trackClassName ? ` ${trackClassName}` : ''}`}
          role={role}
          aria-label={ariaLabel}
        >
          {children}
        </div>
      </div>

      <div className="hscroll-gutter right">
        {canRight && (
          <button
            type="button"
            className="hscroll-nav"
            aria-label="Scroll right"
            onClick={() => scrollByDir(1)}
          >
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
}
