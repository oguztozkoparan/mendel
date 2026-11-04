#!/usr/bin/env node
// Release notes from commit subjects since the previous tag (TECH.md §4):
// feat(scope) -> Features, bug(scope) -> Fixes, feat(release) skipped.
// Usage: node scripts/changelog.mjs [tag] [prevTag]   (tag defaults to HEAD, prevTag to the tag before it)
import { execFileSync } from 'node:child_process'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }).trim()
const [tag = 'HEAD', prev = previousTag(tag)] = process.argv.slice(2)

function previousTag(ref) {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v*', `${ref}^`)
  } catch {
    return '' // first release: whole history
  }
}

const groups = { feat: [], bug: [] }
const log = git('log', '--no-merges', '--format=%s%x1f%h', prev ? `${prev}..${tag}` : tag)
for (const line of log.split('\n').filter(Boolean)) {
  const [subject, hash] = line.split('\x1f')
  const m = /^(feat|bug)\(([^)]+)\): (.+)$/.exec(subject)
  if (m && !(m[1] === 'feat' && m[2] === 'release')) groups[m[1]].push(`- **${m[2]}**: ${m[3]} (${hash})`)
}

const out = []
if (groups.feat.length) out.push('## Features', '', ...groups.feat, '')
if (groups.bug.length) out.push('## Fixes', '', ...groups.bug, '')
process.stdout.write(out.length ? out.join('\n') : 'No user-facing changes.\n')
