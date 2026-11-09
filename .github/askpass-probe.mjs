// TEMP Windows CI probe: which askpass variants deliver their stdout answer to git? (to be dropped)
import { execFileSync, execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import electron from 'electron'
const dir = mkdtempSync(path.join(os.tmpdir(), 'probe-'))
let auth = []
const srv = createServer((q, r) => {
  if (q.headers.authorization) auth.push(Buffer.from(q.headers.authorization.split(' ')[1], 'base64').toString())
  r.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' })
  r.end()
})
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
const url = `http://127.0.0.1:${srv.address().port}/repo.git`
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(dir, 'gc'), GIT_TERMINAL_PROMPT: '0' }
writeFileSync(env.GIT_CONFIG_GLOBAL, '')
// async: the 401 server lives in this process, so a sync spawn would block it.
const run = (label, askpass) =>
  new Promise((done) => {
    auth = []
    execFile('git', ['ls-remote', url], { env: { ...env, GIT_ASKPASS: askpass }, encoding: 'utf8', timeout: 60000 }, (err) => {
      console.log(`[${label}] code=${err?.code ?? 0} server got credentials: ${JSON.stringify(auth)}`)
      done()
    })
  })
const cmd = (name, body) => (writeFileSync(path.join(dir, name), body), path.join(dir, name))
const electronCmd = (name, js) => {
  writeFileSync(path.join(dir, name + '.js'), js)
  return cmd(name + '.cmd', `@echo off\r\nset ELECTRON_RUN_AS_NODE=\r\n"${electron}" "${path.join(dir, name + '.js')}" %*\r\n`)
}
await run('plain-cmd', cmd('plain.cmd', '@echo off\r\necho alice\r\n'))
await run('electron-stdout-stream', electronCmd('e1', `const { app } = require('electron'); app.whenReady().then(() => process.stdout.write('alice\\n', () => app.exit(0)))`))
await run('electron-fs-writeSync-1', electronCmd('e2', `const { app } = require('electron'); app.whenReady().then(() => { require('fs').writeSync(1, 'alice\\n'); app.exit(0) })`))
await run('electron-stdout-no-ready', electronCmd('e3', `const { app } = require('electron'); require('fs').writeSync(1, 'alice\\n'); app.whenReady().then(() => app.exit(0))`))
console.log('git', execFileSync('git', ['--version'], { encoding: 'utf8' }).trim())
srv.close()
