import { app, protocol, session } from 'electron'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveUnder } from './safe-path'

export const APP_SCHEME = 'app'
const PROD_ORIGIN = 'app://gitdock'
/** S13: build-time flag (electron.vite.config.ts), true only in dev and e2e builds; never read from the runtime env. */
export const testSeams = process.env.GITDOCK_TEST_SEAMS === 'true'
const devUrl = testSeams ? process.env.ELECTRON_RENDERER_URL : undefined

/** Origin the renderer is served from; IPC and navigation are only trusted from it. */
export const appOrigin = devUrl ? new URL(devUrl).origin : PROD_ORIGIN
export const appEntryUrl = devUrl ?? `${PROD_ORIGIN}/index.html`

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"
// Dev only: Vite injects the React refresh preamble and CSS as inline tags and uses a websocket for HMR.
const DEV_CSP = CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
  .replace("connect-src 'self'", "connect-src 'self' ws://localhost:*")

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
}

/** Must run before `app.ready`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true } }])
}

/** Session + webContents hardening (TECH.md §6.1). Call once after `app.ready`. */
export function hardenSession(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)

  const root = path.join(__dirname, '../renderer')
  protocol.handle(APP_SCHEME, async (req) => {
    const url = new URL(req.url)
    let rel: string
    try {
      rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    } catch {
      return new Response('Bad request', { status: 400 })
    }
    const file = url.host === 'gitdock' ? resolveUnder(root, rel) : null
    if (!file) return new Response('Not found', { status: 404 })
    try {
      const body = await readFile(file)
      return new Response(body, {
        headers: {
          'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
          'Content-Security-Policy': CSP
        }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  if (devUrl) {
    ses.webRequest.onHeadersReceived({ urls: [`${appOrigin}/*`] }, (details, cb) =>
      cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [DEV_CSP] } })
    )
  }

  app.on('web-contents-created', (_e, contents) => {
    const sameOrigin = (u: string) => {
      try {
        return new URL(u).origin === appOrigin
      } catch {
        return false
      }
    }
    contents.on('will-navigate', (e, u) => sameOrigin(u) || e.preventDefault())
    contents.on('will-redirect', (e, u) => sameOrigin(u) || e.preventDefault())
    contents.on('will-attach-webview', (e) => e.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}
