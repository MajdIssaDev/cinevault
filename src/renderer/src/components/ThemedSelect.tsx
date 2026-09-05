import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

export type SelectOption = {
  value: string
  label: string
}

type Variant = 'default' | 'pill' | 'catalog' | 'settings'

type Props = {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  'aria-label'?: string
  className?: string
  variant?: Variant
  icon?: ReactNode
  disabled?: boolean
  title?: string
  menuMinWidth?: number
}

/** Fullscreen elements hide anything portaled to body — mount inside FS when needed. */
function resolvePortalRoot(anchor: HTMLElement | null): HTMLElement {
  const fs = document.fullscreenElement
  if (fs instanceof HTMLElement && anchor && fs.contains(anchor)) return fs
  return document.body
}

function computeMenuStyle(btn: HTMLElement, menuMinWidth?: number): CSSProperties {
  const rect = btn.getBoundingClientRect()
  const maxH = Math.min(320, window.innerHeight - 24)
  const spaceBelow = window.innerHeight - rect.bottom - 12
  const openUp = spaceBelow < 180 && rect.top > spaceBelow
  const width = Math.max(rect.width, menuMinWidth || 0)
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
  return {
    position: 'fixed',
    left,
    width,
    top: openUp ? undefined : rect.bottom + 6,
    bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
    maxHeight: maxH,
    zIndex: 200000
  }
}

export function ThemedSelect({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  className = '',
  variant = 'default',
  icon,
  disabled,
  title,
  menuMinWidth
}: Props): JSX.Element {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const ignoreOutsideRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const [portalRoot, setPortalRoot] = useState<HTMLElement>(() => document.body)

  const selected = options.find((o) => o.value === value) || options[0]
  const label = selected?.label ?? value

  const syncPortalRoot = (): void => {
    setPortalRoot(resolvePortalRoot(rootRef.current))
  }

  const placeMenu = (): void => {
    const btn = btnRef.current
    if (!btn) return
    setMenuStyle(computeMenuStyle(btn, menuMinWidth))
  }

  const close = (): void => {
    setOpen(false)
    setMenuStyle(null)
  }

  const openMenu = (): void => {
    const btn = btnRef.current
    if (!btn) return
    // Ignore the same gesture that opened the menu so the document listener
    // does not immediately dismiss it (common in Electron / pointer pipelines).
    ignoreOutsideRef.current = true
    syncPortalRoot()
    setMenuStyle(computeMenuStyle(btn, menuMinWidth))
    setOpen(true)
    window.setTimeout(() => {
      ignoreOutsideRef.current = false
    }, 0)
  }

  const toggle = (e: ReactMouseEvent | ReactPointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    if (open) close()
    else openMenu()
  }

  useLayoutEffect(() => {
    if (!open) return
    syncPortalRoot()
    placeMenu()
  }, [open, options.length, menuMinWidth])

  useEffect(() => {
    const onFs = (): void => {
      syncPortalRoot()
      if (open) placeMenu()
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [open, menuMinWidth])

  useEffect(() => {
    if (!open) return

    const isInside = (t: EventTarget | null): boolean => {
      const node = t as Node | null
      if (!node) return false
      return Boolean(rootRef.current?.contains(node) || menuRef.current?.contains(node))
    }

    const onOutside = (e: Event): void => {
      if (ignoreOutsideRef.current) return
      if (isInside(e.target)) return
      close()
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }

    const onReposition = (): void => placeMenu()

    // Defer bind so the opening click/pointerdown cannot dismiss immediately.
    const bindTimer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onOutside, true)
      document.addEventListener('mousedown', onOutside, true)
      window.addEventListener('keydown', onKey)
      window.addEventListener('resize', onReposition)
      window.addEventListener('scroll', onReposition, true)
    }, 0)

    return () => {
      window.clearTimeout(bindTimer)
      document.removeEventListener('pointerdown', onOutside, true)
      document.removeEventListener('mousedown', onOutside, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, menuMinWidth])

  return (
    <div
      ref={rootRef}
      className={`themed-select${className ? ` ${className}` : ''}${open ? ' open' : ''}`}
      data-variant={variant}
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={btnRef}
        type="button"
        className="themed-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        disabled={disabled}
        onPointerDown={(e) => {
          // Prevent parent player stage / chrome handlers from eating the gesture.
          e.stopPropagation()
        }}
        onClick={toggle}
      >
        {icon && <span className="themed-select-icon">{icon}</span>}
        <span className="themed-select-label">{label}</span>
        <ChevronDown size={14} strokeWidth={2} className="themed-select-chevron" aria-hidden />
      </button>

      {open &&
        menuStyle &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            className="themed-select-menu"
            role="listbox"
            aria-label={ariaLabel}
            style={menuStyle}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {options.map((opt) => {
              const active = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`themed-select-option${active ? ' active' : ''}`}
                  onClick={() => {
                    onChange(opt.value)
                    close()
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>,
          portalRoot
        )}
    </div>
  )
}
