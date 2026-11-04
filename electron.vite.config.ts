import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => ({
  main: {
    define: {
      // Build flag (TECH.md §4): macOS self-install only for signed builds; release CI sets it when signing secrets exist.
      'process.env.GITDOCK_MAC_AUTOINSTALL': JSON.stringify(process.env.GITDOCK_MAC_AUTOINSTALL ?? 'false'),
      // S13: test/dev seams (GITDOCK_E2E_* env, __gitdockTest, mock keychain, dev origin, debugger switches) exist only in
      // `electron-vite dev` and `--mode e2e` builds; a plain build (npm run build / dist) compiles them out.
      'process.env.GITDOCK_TEST_SEAMS': JSON.stringify(command === 'serve' || mode === 'e2e' ? 'true' : 'false')
    }
  },
  // Sandboxed preload can only require('electron'): bundle everything else.
  preload: { build: { externalizeDeps: false } },
  renderer: { plugins: [react()] }
}))
