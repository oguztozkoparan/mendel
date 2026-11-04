import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Build flag (TECH.md §4): macOS self-install only for signed builds; release CI sets it when signing secrets exist.
  main: { define: { 'process.env.GITDOCK_MAC_AUTOINSTALL': JSON.stringify(process.env.GITDOCK_MAC_AUTOINSTALL ?? 'false') } },
  // Sandboxed preload can only require('electron'): bundle everything else.
  preload: { build: { externalizeDeps: false } },
  renderer: { plugins: [react()] }
})
