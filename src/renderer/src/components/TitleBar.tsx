import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { NavLink } from 'react-router-dom'
import { useAppStore } from '../store'
import { isMobileShell } from '../lib/platform'
import { Tooltip } from './ui/Tooltip'

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties
const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties

function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const api = window.cinevault?.window
    if (!api?.isMaximized) return
    void api.isMaximized().then(setMaximized)
    return api.onMaximizedChanged?.(setMaximized)
  }, [])

  const minimize = (): void => {
    void window.cinevault?.window.minimize()
  }
  const toggleMaximize = (): void => {
    void window.cinevault?.window.toggleMaximize().then(setMaximized)
  }
  const close = (): void => {
    void window.cinevault?.window.close()
  }

  return (
    <div className="titlebar-controls" style={noDragStyle} onPointerDown={(e) => e.stopPropagation()}>
      <Tooltip content="Minimize" side="bottom" className="mono-tooltip--stretch">
        <button
          type="button"
          className="titlebar-win-btn"
          aria-label="Minimize"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            minimize()
          }}
        >
          <span className="titlebar-win-min" aria-hidden />
        </button>
      </Tooltip>
      <Tooltip content={maximized ? 'Restore' : 'Maximize'} side="bottom" className="mono-tooltip--stretch">
        <button
          type="button"
          className="titlebar-win-btn"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            toggleMaximize()
          }}
        >
          {maximized ? (
            <span className="titlebar-win-restore" aria-hidden />
          ) : (
            <span className="titlebar-win-max" aria-hidden />
          )}
        </button>
      </Tooltip>
      <Tooltip content="Close" side="bottom" className="mono-tooltip--stretch">
        <button
          type="button"
          className="titlebar-win-btn titlebar-win-close"
          aria-label="Close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            close()
          }}
        >
          <svg
            className="titlebar-win-x"
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden
          >
            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </Tooltip>
    </div>
  )
}

/** Pointer-driven window move (works when CSS app-region fails over the player). */
function useWindowDrag(enabled: boolean): {
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerMove?: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp?: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel?: (e: ReactPointerEvent<HTMLElement>) => void
} {
  const dragging = useRef(false)

  if (!enabled) return {}

  const end = (e: ReactPointerEvent<HTMLElement>): void => {
    if (!dragging.current) return
    dragging.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    void window.cinevault?.window.dragEnd?.()
  }

  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return
      if (!window.cinevault?.window.dragStart) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('.titlebar-controls, .titlebar-win-btn, .titlebar-icon, .mono-tooltip')) return
      e.preventDefault()
      e.stopPropagation()
      dragging.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      void window.cinevault.window.dragStart()
    },
    onPointerMove: (e) => {
      if (!dragging.current) return
      e.preventDefault()
      void window.cinevault?.window.dragMove?.()
    },
    onPointerUp: end,
    onPointerCancel: end
  }
}

export function TitleBar(): JSX.Element {
  const updateAvailable = useAppStore((s) => s.updateAvailable)
  const playerOpen = Boolean(useAppStore((s) => s.session))
  const showControls = Boolean(window.cinevault?.window) && !isMobileShell()
  const windowDrag = useWindowDrag(playerOpen)

  const onDragDoubleClick = (e: ReactMouseEvent): void => {
    if (!showControls) return
    const t = e.target as HTMLElement | null
    if (t?.closest?.('.titlebar-controls, .titlebar-win-btn, .titlebar-icon, .mono-tooltip')) return
    void window.cinevault?.window.toggleMaximize()
  }

  const settingsLabel = updateAvailable ? 'Settings · Update available' : 'Settings'

  return (
    <header
      className={`titlebar${playerOpen ? ' titlebar-player' : ''}`}
      style={playerOpen ? noDragStyle : dragStyle}
      onDoubleClick={onDragDoubleClick}
      {...windowDrag}
    >
      <div className="titlebar-left" style={noDragStyle}>
        <div className="brand">CineVault</div>
        <Tooltip content={settingsLabel} shortcut="Ctrl+," side="bottom" disabled={playerOpen}>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `titlebar-icon${isActive ? ' active' : ''}${updateAvailable ? ' has-update' : ''}`
            }
            aria-label={settingsLabel}
            style={noDragStyle}
            tabIndex={playerOpen ? -1 : undefined}
            aria-hidden={playerOpen || undefined}
            onClick={(e) => {
              if (playerOpen) e.preventDefault()
            }}
            onPointerDown={(e) => {
              if (playerOpen) e.preventDefault()
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M19.4 13a7.7 7.7 0 0 0 .1-2l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-6l-.4 2.9a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.7 7.7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 1.7 1L9 21h6l.4-2.9a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
            {updateAvailable && <span className="titlebar-update-dot" aria-hidden />}
          </NavLink>
        </Tooltip>
      </div>
      <div className="titlebar-drag-space" />
      {showControls && <WindowControls />}
    </header>
  )
}
