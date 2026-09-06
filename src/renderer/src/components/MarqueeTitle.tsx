import { HoverScrollTitle } from './HoverScrollTitle'

/**
 * CSS-oriented title scroll. Uses HoverScrollTitle under the hood so overflow
 * is measured exactly (avoids layout-timing bugs from blind translate percentages).
 */
export function MarqueeTitle({
  title,
  className = '',
  isCardHovered
}: {
  title: string
  className?: string
  isCardHovered?: boolean
}): JSX.Element {
  return <HoverScrollTitle title={title} className={className} active={isCardHovered} />
}
