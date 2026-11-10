#!/usr/bin/env node
// Release notes from commit subjects since the previous tag (TECH.md §4):
// feat(scope) -> Features, bug(scope) -> Fixes, feat(release) skipped; a version tag also gets an Install section.
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
if (!out.length) out.push('No user-facing changes.', '')
// Format: docs/RELEASE.md -> Release notes. Only for a version tag; the unsigned-build line goes when signing lands.
const v = /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1]
if (v)
  out.push(
    '## Install',
    '',
    '| Platform | File |',
    '|---|---|',
    `| macOS (Apple silicon) | \`Mendel-${v}-arm64.dmg\` |`,
    `| macOS (Intel) | \`Mendel-${v}.dmg\` |`,
    `| Windows | \`Mendel-Setup-${v}.exe\` |`,
    `| Linux | \`Mendel-${v}.AppImage\` or \`mendel_${v}_amd64.deb\` |`,
    '',
    'Needs git 2.30 or newer on the PATH. Builds are not code-signed yet: on macOS allow the first launch in System Settings → Privacy & Security → Open Anyway; on Windows choose More info → Run anyway.',
    ''
  )
process.stdout.write(out.join('\n'))
