import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
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

function computeMenuStyle(
  btn: HTMLElement,
  menuMinWidth?: number
): CSSProperties {
  const rect = btn.getBoundingClientRect()
  const maxH = Math.min(280, window.innerHeight - 24)
  const spaceBelow = window.innerHeight - rect.bottom - 12
  const openUp = spaceBelow < 160 && rect.top > spaceBelow
  const width = Math.max(rect.width, menuMinWidth || 0)
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
  return {
    position: 'fixed',
    left,
    width,
    top: openUp ? undefined : rect.bottom + 6,
    bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
    maxHeight: maxH,
    zIndex: 10050
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
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)

  const selected = options.find((o) => o.value === value) || options[0]
  const label = selected?.label ?? value

  const placeMenu = (): void => {
    const btn = btnRef.current
    if (!btn) return
    setMenuStyle(computeMenuStyle(btn, menuMinWidth))
  }

  const toggle = (): void => {
    if (open) {
      setOpen(false)
      setMenuStyle(null)
      return
    }
    const btn = btnRef.current
    if (!btn) return
    // Position before paint so the menu never flashes at 0,0
    setMenuStyle(computeMenuStyle(btn, menuMinWidth))
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open) return
    placeMenu()
  }, [open, options.length, menuMinWidth])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
      setMenuStyle(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        setMenuStyle(null)
      }
    }
    const onReposition = (): void => placeMenu()
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
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
                    setOpen(false)
                    setMenuStyle(null)
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </div>
  )
}
