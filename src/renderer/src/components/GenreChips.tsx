import type { ReactNode } from 'react'
import { HScrollRail } from './HScrollRail'

/** Horizontal genre pills: wheel→horizontal, edge chevrons, fade masks. */
export function GenreChips({
  children,
  'aria-label': ariaLabel
}: {
  children: ReactNode
  'aria-label'?: string
}): JSX.Element {
  return (
    <HScrollRail aria-label={ariaLabel || 'Genres'} role="tablist" trackClassName="genre-chips">
      {children}
    </HScrollRail>
  )
}
