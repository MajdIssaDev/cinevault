import type { CineVaultApi } from './index'

declare global {
  interface Window {
    cinevault: CineVaultApi
  }
}

export {}
