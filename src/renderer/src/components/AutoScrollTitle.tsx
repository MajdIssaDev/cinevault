import { HoverScrollTitle } from './HoverScrollTitle'

/** @deprecated Prefer HoverScrollTitle. */
export function AutoScrollTitle({
  text,
  className = '',
  isCardHovered
}: {
  text: string
  className?: string
  isCardHovered?: boolean
}): JSX.Element {
  return <HoverScrollTitle title={text} className={className} active={isCardHovered} />
}
