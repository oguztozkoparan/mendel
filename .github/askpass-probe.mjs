// Windows CI probe: does git run a .cmd GIT_ASKPASS, and does an Electron askpass child reach git?
import { execFileSync, execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import electron from 'electron'
const dir = mkdtempSync(path.join(os.tmpdir(), 'probe-'))
const srv = createServer((q, r) => { r.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' }); r.end() })
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
const url = `http://127.0.0.1:${srv.address().port}/repo.git`
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(dir, 'gc'), GIT_TERMINAL_PROMPT: '0' }
writeFileSync(env.GIT_CONFIG_GLOBAL, '')
// async: the 401 server lives in this process, so a sync spawn would block it.
const run = (label, askpass) => new Promise((done) => {
  const mark = path.join(dir, label + '.called')
  execFile('git', ['ls-remote', url], { env: { ...env, GIT_ASKPASS: askpass, PROBE_MARK: mark }, encoding: 'utf8', timeout: 30000 }, (err, _out, stderr) => {
    console.log(`[${label}] code=${err?.code ?? 0} called=${existsSync(mark)} mark=${existsSync(mark) ? readFileSync(mark, 'utf8').trim() : ''}\n  stderr: ${(stderr || String(err)).trim().split('\n').slice(-3).join(' | ')}`)
    done()
  })
})
const cmd1 = path.join(dir, 'plain.cmd')
writeFileSync(cmd1, '@echo off\r\necho %* > "%PROBE_MARK%"\r\necho alice\r\n')
await run('plain-cmd', cmd1)
const main = path.join(dir, 'main.js')
writeFileSync(main, `const { app } = require('electron'); require('fs').writeFileSync(process.env.PROBE_MARK, process.argv.at(-1)); app.whenReady().then(() => process.stdout.write('alice\\n', () => app.exit(0)))`)
const cmd2 = path.join(dir, 'electron.cmd')
writeFileSync(cmd2, `@echo off\r\nset ELECTRON_RUN_AS_NODE=\r\n"${electron}" "${main}" %*\r\n`)
await run('electron-cmd', cmd2)
console.log('git', execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(), 'electron', electron)
srv.close()
