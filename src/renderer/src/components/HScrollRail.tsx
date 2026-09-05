import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const SCROLL_STEP = 320
const EDGE_EPS = 10

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
    setCanLeft(scrollLeft > EDGE_EPS)
    setCanRight(scrollLeft < scrollWidth - clientWidth - EDGE_EPS)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      el.scrollLeft += e.deltaY
      updateEdges()
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', updateEdges, { passive: true })

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateEdges) : null
    ro?.observe(el)

    updateEdges()
    const t = window.setTimeout(updateEdges, 50)

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', updateEdges)
      ro?.disconnect()
      window.clearTimeout(t)
    }
  }, [updateEdges, children])

  const scrollByDir = (direction: -1 | 1): void => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: direction * SCROLL_STEP, behavior: 'smooth' })
  }

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

      <div className="hscroll-wrap">
        <div ref={ref} className={`hscroll-track${trackClassName ? ` ${trackClassName}` : ''}`} role={role} aria-label={ariaLabel}>
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
