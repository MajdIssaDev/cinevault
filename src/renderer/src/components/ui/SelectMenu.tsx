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
import { Check, ChevronDown } from 'lucide-react'

export type SelectMenuOption = {
  label: string
  value: string
  subtitle?: string
}

/** Alias matching the Studio Monolith API sketch. */
export type Option = SelectMenuOption

type Variant = 'default' | 'pill' | 'catalog' | 'settings' | 'compact'

export interface SelectMenuProps {
  options: SelectMenuOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  /** @deprecated Prefer className; kept for ThemedSelect compatibility. */
  variant?: Variant
  icon?: ReactNode
  disabled?: boolean
  title?: string
  menuMinWidth?: number
  'aria-label'?: string
}

/** Fullscreen elements hide body portals — mount inside FS when needed. */
function resolvePortalRoot(anchor: HTMLElement | null): HTMLElement {
  const fs = document.fullscreenElement
  if (fs instanceof HTMLElement && anchor && fs.contains(anchor)) return fs
  return document.body
}

function computeMenuStyle(btn: HTMLElement, menuMinWidth?: number): CSSProperties {
  const rect = btn.getBoundingClientRect()
  const margin = 8
  const gap = 6
  const preferredMax = 280
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - margin)
  const spaceAbove = Math.max(0, rect.top - gap - margin)
  // Flip up when the lower viewport slice is too short to show a usable list
  const openUp = spaceBelow < Math.min(180, preferredMax) && spaceAbove > spaceBelow
  const available = openUp ? spaceAbove : spaceBelow
  // Never let the panel extend past the visible window — scrolling stays inside the viewport
  const maxHeight = Math.max(96, Math.min(preferredMax, available))
  const width = Math.max(rect.width, menuMinWidth || 170)
  const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin))

  if (openUp) {
    return {
      position: 'fixed',
      left,
      width,
      bottom: window.innerHeight - rect.top + gap,
      maxHeight,
      zIndex: 200000
    }
  }

  return {
    position: 'fixed',
    left,
    width,
    top: rect.bottom + gap,
    maxHeight,
    zIndex: 200000
  }
}

/**
 * Studio Monolith select — obsidian glass panel, squircle trigger, checkmarks.
 */
export function SelectMenu({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  className = '',
  variant = 'default',
  icon,
  disabled,
  title,
  menuMinWidth,
  'aria-label': ariaLabel
}: SelectMenuProps): JSX.Element {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const ignoreOutsideRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const [portalRoot, setPortalRoot] = useState<HTMLElement>(() => document.body)

  const selected = options.find((o) => o.value === value)
  const label = selected?.label ?? placeholder

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
      className={`select-menu themed-select${className ? ` ${className}` : ''}${open ? ' open' : ''}`}
      data-variant={variant}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={btnRef}
        type="button"
        className="select-menu-trigger themed-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        disabled={disabled}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={toggle}
      >
        {icon ? <span className="select-menu-icon themed-select-icon">{icon}</span> : null}
        <span className="select-menu-label themed-select-label">{label}</span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          className="select-menu-chevron themed-select-chevron"
          aria-hidden
        />
      </button>

      {open &&
        menuStyle &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            className="select-menu-panel themed-select-menu scrollbar-thin"
            role="listbox"
            aria-label={ariaLabel}
            style={menuStyle}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {options.map((opt) => {
              const isSelected = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`select-menu-option themed-select-option${isSelected ? ' active' : ''}`}
                  onClick={() => {
                    onChange(opt.value)
                    close()
                  }}
                >
                  <span className="select-menu-option-copy">
                    <span className="select-menu-option-label">{opt.label}</span>
                    {opt.subtitle ? (
                      <span className="select-menu-option-sub">{opt.subtitle}</span>
                    ) : null}
                  </span>
                  {isSelected ? (
                    <Check
                      size={14}
                      strokeWidth={2.5}
                      className="select-menu-check"
                      aria-hidden
                    />
                  ) : null}
                </button>
              )
            })}
          </div>,
          portalRoot
        )}
    </div>
  )
}
