import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

/**
 * Standalone web build for Capacitor (iOS / Android).
 * Output → dist/ (see capacitor.config.ts webDir).
 */
export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  publicDir: resolve('resources'),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  build: {
    outDir: resolve('dist'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020',
    rollupOptions: {
      input: resolve('src/renderer/index.html')
    }
  },
  define: {
    __CINEVAULT_MOBILE__: true
  }
})
