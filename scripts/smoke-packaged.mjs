// Packaged-app smoke test: node scripts/smoke-packaged.mjs <app executable>
// e.g. release/mac-arm64/gitdock.app/Contents/MacOS/gitdock. Fuses forbid --inspect, so Playwright's
// _electron can't attach; drive the window over CDP (--remote-debugging-port) instead. Exit 0 = welcome renders.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const bin = process.argv[2]
if (!bin) throw new Error('usage: node scripts/smoke-packaged.mjs <app executable>')
const userData = mkdtempSync(path.join(tmpdir(), 'gitdock-pkg-')) // never the user's real app state
const port = 9300 + Math.floor(Math.random() * 500)
const t0 = Date.now()
const app = spawn(bin, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
app.stdout.on('data', (d) => (output += d))
app.stderr.on('data', (d) => (output += d))
const exited = new Promise((r) => app.on('exit', r))

let ok = false
try {
  let browser = null
  for (let i = 0; i < 240 && !browser && app.exitCode === null && app.signalCode === null; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null)
    if (!browser) await new Promise((r) => setTimeout(r, 250))
  }
  if (!browser) throw new Error(`no window (exit ${app.exitCode ?? app.signalCode})`)
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0] ?? (await ctx.waitForEvent('page'))
  await page.getByRole('button', { name: 'Open local repository…' }).waitFor({ timeout: 15_000 })
  const ms = Date.now() - t0
  await page.getByText(/^git \d+\.\d+.* found at /).waitFor({ timeout: 10_000 })
  const info = await page.evaluate(() => ({ url: location.href, require: typeof window.require, process: typeof window.process }))
  console.log(`welcome rendered after ${ms} ms`, info)
  ok = info.url === 'app://gitdock/index.html' && info.require === 'undefined' && info.process === 'undefined'
  await browser.close().catch(() => {})
} catch (err) {
  console.error('FAIL', err.message, output.slice(-2000))
}
if (app.exitCode === null && app.signalCode === null) app.kill()
await exited
rmSync(userData, { recursive: true, force: true })
process.exit(ok ? 0 : 1)
