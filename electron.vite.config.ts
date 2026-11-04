import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  // Sandboxed preload can only require('electron'): bundle everything else.
  preload: { build: { externalizeDeps: false } },
  renderer: { plugins: [react()] }
})
