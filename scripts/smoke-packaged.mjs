// Packaged-app smoke test: node scripts/smoke-packaged.mjs [--refuses] <app executable>
// e.g. release-smoke/mac-arm64/gitdock.app/Contents/MacOS/gitdock (from `npm run dist:smoke`). Fuses forbid --inspect,
// so Playwright's _electron can't attach; drive the window over CDP (--remote-debugging-port) instead, which only an
// e2e-mode build allows (S13/P2). Exit 0 = welcome renders.
// --refuses <release build exe> (from `npm run dist`): exit 0 = it quits at once on debugger switches (P2).
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const refuses = process.argv[2] === '--refuses'
const bin = process.argv[refuses ? 3 : 2]
if (!bin) throw new Error('usage: node scripts/smoke-packaged.mjs [--refuses] <app executable>')
const userData = mkdtempSync(path.join(tmpdir(), 'gitdock-pkg-')) // never the user's real app state

if (refuses) {
  let ok = true
  for (const sw of ['--remote-debugging-port=9222', '-remote-debugging-port=9222', '--remote-debugging-pipe', '--inspect=9229']) {
    const p = spawn(bin, [sw, `--user-data-dir=${userData}`], { stdio: 'ignore' })
    const code = await Promise.race([new Promise((r) => p.on('exit', (c) => r(c))), new Promise((r) => setTimeout(() => r('running'), 10_000))])
    if (code === 'running') p.kill()
    console.log(`${sw}: ${code === 'running' ? 'still running after 10 s' : `exited ${code}`}`)
    ok &&= code !== 'running' && code !== 0
  }
  rmSync(userData, { recursive: true, force: true })
  process.exit(ok ? 0 : 1)
}
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
