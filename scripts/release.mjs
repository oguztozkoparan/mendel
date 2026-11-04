#!/usr/bin/env node
// npm run release -- <major|minor|patch>: verify, bump, commit `feat(release): vX.Y.Z`, tag vX.Y.Z. Never pushes.
import { execFileSync } from 'node:child_process'

const bump = process.argv[2]
const fail = (msg) => {
  console.error(`release: ${msg}`)
  process.exit(1)
}
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
// shortcut: macOS/Linux only (Windows needs npm.cmd via a shell); add that if releases are cut on Windows.
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

if (!['major', 'minor', 'patch'].includes(bump)) fail('usage: npm run release -- <major|minor|patch>')
if (sh('git', ['status', '--porcelain'])) fail('working tree is not clean')
const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') fail(`must be on main (on ${branch})`)
// The tag must be on origin/main (release.yml checks it too): fetch, then require HEAD == origin/main.
run('git', ['fetch', '--quiet', 'origin', 'main'])
if (sh('git', ['rev-parse', 'HEAD']) !== sh('git', ['rev-parse', 'origin/main'])) fail('HEAD is not origin/main (pull or push first)')

run('npm', ['run', 'typecheck'])
run('npm', ['test'])
// The message must pass scripts/commit-msg; npm's default ("1.2.0") would be rejected.
run('npm', ['version', bump, '-m', 'feat(release): v%s'])
console.log(`\nTagged v${sh('node', ['-p', "require('./package.json').version"])}. Push when ready: git push --follow-tags`)
