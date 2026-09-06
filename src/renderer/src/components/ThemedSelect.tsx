import type { ReactNode } from 'react'
import { SelectMenu, type SelectMenuOption } from './ui/SelectMenu'

export type SelectOption = SelectMenuOption

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

/** @deprecated Prefer `SelectMenu` from `components/ui/SelectMenu`. */
export function ThemedSelect(props: Props): JSX.Element {
  return <SelectMenu {...props} />
}
