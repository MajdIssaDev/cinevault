type HeroProgressBarsProps = {
  count: number
  activeIndex: number
  paused: boolean
  /** Bumps to restart the fill animation for the active segment. */
  cycleKey: number
  durationMs: number
  onSelect: (index: number) => void
  onActiveComplete: () => void
}

export function HeroProgressBars({
  count,
  activeIndex,
  paused,
  cycleKey,
  durationMs,
  onSelect,
  onActiveComplete
}: HeroProgressBarsProps): JSX.Element | null {
  if (count < 2) return null

  return (
    <div className="hero-progress-bars" role="tablist" aria-label="Featured slides">
      {Array.from({ length: count }, (_, idx) => {
        const isActive = idx === activeIndex
        return (
          <button
            key={idx}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={`Featured ${idx + 1} of ${count}`}
            className={`hero-progress-seg${isActive ? ' is-active' : ''}`}
            onClick={() => onSelect(idx)}
          >
            {isActive ? (
              <span
                key={`${cycleKey}-${idx}`}
                className={`hero-progress-fill${paused ? ' is-paused' : ''}`}
                style={{ animationDuration: `${durationMs}ms` }}
                onAnimationEnd={(e) => {
                  if (e.animationName === 'hero-progress-fill') onActiveComplete()
                }}
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
