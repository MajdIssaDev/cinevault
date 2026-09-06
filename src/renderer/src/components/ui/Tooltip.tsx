import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

interface TooltipProps {
  content: ReactNode
  shortcut?: string
  children: ReactElement
  side?: TooltipSide
  delay?: number
  /** Extra class on the wrapper (e.g. stretch for titlebar win buttons). */
  className?: string
  disabled?: boolean
}

type Coord = { top: number; left: number }

const VIEW_PAD = 12

/**
 * Studio Monolith frosted-obsidian tooltip.
 * Portals the bubble so parent `overflow: hidden` cannot clip it.
 */
export function Tooltip({
  content,
  shortcut,
  children,
  side = 'top',
  delay = 200,
  className = '',
  disabled = false
}: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState<Coord | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const tipId = useId()

  const clearTimer = (): void => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const anchorPoint = (): Coord | null => {
    const el = wrapRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const gap = 10
    switch (side) {
      case 'bottom':
        return { top: r.bottom + gap, left: r.left + r.width / 2 }
      case 'left':
        return { top: r.top + r.height / 2, left: r.left - gap }
      case 'right':
        return { top: r.top + r.height / 2, left: r.right + gap }
      case 'top':
      default:
        return { top: r.top - gap, left: r.left + r.width / 2 }
    }
  }

  const clampCoords = (raw: Coord): Coord => {
    const tip = tipRef.current
    if (!tip) return raw
    const br = tip.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { top, left } = raw

    if (side === 'top' || side === 'bottom') {
      const half = br.width / 2
      if (left - half < VIEW_PAD) left = VIEW_PAD + half
      if (left + half > vw - VIEW_PAD) left = vw - VIEW_PAD - half
    } else {
      if (side === 'left' && left - br.width < VIEW_PAD) left = VIEW_PAD + br.width
      if (side === 'right' && left + br.width > vw - VIEW_PAD) left = vw - VIEW_PAD - br.width
      const halfH = br.height / 2
      if (top - halfH < VIEW_PAD) top = VIEW_PAD + halfH
      if (top + halfH > vh - VIEW_PAD) top = vh - VIEW_PAD - halfH
    }

    if (side === 'top' && top - br.height < VIEW_PAD) top = VIEW_PAD + br.height
    if (side === 'bottom' && top + br.height > vh - VIEW_PAD) top = Math.max(VIEW_PAD, vh - VIEW_PAD - br.height)

    return { top, left }
  }

  const measure = (): Coord | null => {
    const raw = anchorPoint()
    if (!raw) return null
    const next = tipRef.current ? clampCoords(raw) : raw
    setCoords((prev) => {
      if (
        prev &&
        Math.abs(prev.left - next.left) < 0.5 &&
        Math.abs(prev.top - next.top) < 0.5
      ) {
        return prev
      }
      return next
    })
    return next
  }

  const show = (): void => {
    if (disabled || content == null || content === '') return
    clearTimer()
    timerRef.current = setTimeout(() => {
      const raw = anchorPoint()
      if (raw) setCoords(raw)
      setVisible(true)
    }, delay)
  }

  const hide = (): void => {
    clearTimer()
    setVisible(false)
    setCoords(null)
  }

  useEffect(() => () => clearTimer(), [])

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    const onScroll = (): void => measure()
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [visible, side])

  useLayoutEffect(() => {
    if (!visible) return
    // Re-measure after portal mount so tipRef size is available for viewport clamp
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measure closes over side/refs
  }, [visible, side, content])

  const willPortal = Boolean(visible && !disabled && coords && typeof document !== 'undefined')

  const child = cloneElement(children, {
    title: undefined,
    'aria-describedby': visible
      ? tipId
      : (children.props as { 'aria-describedby'?: string })['aria-describedby']
  } as Partial<typeof children.props>)

  const bubbleStyle: CSSProperties | undefined = coords
    ? {
        position: 'fixed',
        zIndex: 2147483000,
        top: coords.top,
        left: coords.left,
        opacity: 1,
        visibility: 'visible',
        display: 'inline-flex',
        pointerEvents: 'none',
        transform:
          side === 'top'
            ? 'translate(-50%, -100%)'
            : side === 'bottom'
              ? 'translate(-50%, 0)'
              : side === 'left'
                ? 'translate(-100%, -50%)'
                : 'translate(0, -50%)'
      }
    : undefined

  return (
    <span
      ref={wrapRef}
      className={`mono-tooltip${className ? ` ${className}` : ''}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {child}
      {willPortal
        ? createPortal(
            <span
              ref={tipRef}
              id={tipId}
              role="tooltip"
              className={`mono-tooltip-bubble mono-tooltip-portal mono-tooltip-${side}`}
              style={bubbleStyle}
            >
              <span className="mono-tooltip-label">{content}</span>
              {shortcut ? <kbd className="mono-tooltip-kbd">{shortcut}</kbd> : null}
            </span>,
            document.body
          )
        : null}
    </span>
  )
}
