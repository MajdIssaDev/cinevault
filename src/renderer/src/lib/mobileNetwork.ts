/**
 * Warn when streaming / torrenting over cellular.
 */
import { Network } from '@capacitor/network'
import { isMobileShell } from './platform'

export type CellularWarning = {
  onCellular: boolean
  connectionType: string
}

export async function getCellularStatus(): Promise<CellularWarning> {
  if (!isMobileShell()) {
    return { onCellular: false, connectionType: 'unknown' }
  }
  try {
    const status = await Network.getStatus()
    const type = status.connectionType || 'unknown'
    const onCellular = status.connected && type === 'cellular'
    return { onCellular, connectionType: type }
  } catch {
    return { onCellular: false, connectionType: 'unknown' }
  }
}

export async function warnIfCellular(actionLabel = 'streaming'): Promise<boolean> {
  const { onCellular } = await getCellularStatus()
  if (!onCellular) return true
  return window.confirm(
    `You appear to be on cellular data. Continue ${actionLabel}? This may use a large amount of data.`
  )
}

export function subscribeCellular(
  cb: (status: CellularWarning) => void
): () => void {
  if (!isMobileShell()) return () => undefined
  let handle: { remove: () => Promise<void> } | undefined
  void Network.addListener('networkStatusChange', (status) => {
    cb({
      onCellular: status.connected && status.connectionType === 'cellular',
      connectionType: status.connectionType || 'unknown'
    })
  }).then((h) => {
    handle = h
  })
  return () => {
    void handle?.remove()
  }
}
