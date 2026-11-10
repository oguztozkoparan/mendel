#!/usr/bin/env node
// npm run release [-- <major|minor|patch>]: verify, bump, commit `feat(release): vX.Y.Z`, tag vX.Y.Z. Never pushes.
// Without an argument the bump comes from the commits since the last tag: any feat -> minor, only bug -> patch.
// No tag yet (first release): package.json's version is tagged as it is.
import { execFileSync } from 'node:child_process'

const bump = process.argv[2]
const fail = (msg) => {
  console.error(`release: ${msg}`)
  process.exit(1)
}
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
// shortcut: macOS/Linux only (Windows needs npm.cmd via a shell); add that if releases are cut on Windows.
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

if (bump && !['major', 'minor', 'patch'].includes(bump)) fail('usage: npm run release [-- <major|minor|patch>]')
if (sh('git', ['status', '--porcelain'])) fail('working tree is not clean')
const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') fail(`must be on main (on ${branch})`)
// The tag must be on origin/main (release.yml checks it too): fetch, then require HEAD == origin/main.
run('git', ['fetch', '--quiet', 'origin', 'main'])
if (sh('git', ['rev-parse', 'HEAD']) !== sh('git', ['rev-parse', 'origin/main'])) fail('HEAD is not origin/main (pull or push first)')

let last = ''
try {
  last = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], { encoding: 'utf8', stdio: 'pipe' }).trim()
} catch {
  // no tag yet
}
let kind = bump
if (!kind && last) {
  const subjects = sh('git', ['log', '--format=%s', `${last}..HEAD`]).split('\n')
  if (subjects.some((s) => /^feat\((?!release\))/.test(s))) kind = 'minor'
  else if (subjects.some((s) => s.startsWith('bug('))) kind = 'patch'
  else fail(`no feat/bug commits since ${last}`)
}
console.log(kind ? `release: ${kind} bump (last tag ${last || 'none'})` : 'release: first release, tagging the current version')

run('npm', ['run', 'typecheck'])
run('npm', ['test'])
if (kind) {
  // The message must pass scripts/commit-msg; npm's default ("1.2.0") would be rejected.
  run('npm', ['version', kind, '-m', 'feat(release): v%s'])
} else {
  const v = `v${sh('node', ['-p', "require('./package.json').version"])}`
  run('git', ['tag', '-a', v, '-m', v]) // annotated, so `git push --follow-tags` sends it
}
console.log(`\nTagged v${sh('node', ['-p', "require('./package.json').version"])}. Push when ready: git push --follow-tags`)
