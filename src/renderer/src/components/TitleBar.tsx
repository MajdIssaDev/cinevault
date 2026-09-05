import { useEffect, useState, type CSSProperties } from 'react'
import { NavLink } from 'react-router-dom'
import { useAppStore } from '../store'
import { isMobileShell } from '../lib/platform'

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
      <button
        type="button"
        className="titlebar-win-btn"
        title="Minimize"
        aria-label="Minimize"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          minimize()
        }}
      >
        <span className="titlebar-win-min" aria-hidden />
      </button>
      <button
        type="button"
        className="titlebar-win-btn"
        title={maximized ? 'Restore' : 'Maximize'}
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
      <button
        type="button"
        className="titlebar-win-btn titlebar-win-close"
        title="Close"
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
    </div>
  )
}

export function TitleBar(): JSX.Element {
  const updateAvailable = useAppStore((s) => s.updateAvailable)
  const showControls = Boolean(window.cinevault?.window) && !isMobileShell()

  const onDragDoubleClick = (): void => {
    if (!showControls) return
    void window.cinevault?.window.toggleMaximize()
  }

  return (
    <header className="titlebar" style={dragStyle} onDoubleClick={onDragDoubleClick}>
      <div className="titlebar-left" style={noDragStyle}>
        <div className="brand">CineVault</div>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `titlebar-icon${isActive ? ' active' : ''}${updateAvailable ? ' has-update' : ''}`
          }
          title={updateAvailable ? 'Settings · Update available' : 'Settings'}
          style={noDragStyle}
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
      </div>
      <div className="titlebar-drag-space" />
      {showControls && <WindowControls />}
    </header>
  )
}
