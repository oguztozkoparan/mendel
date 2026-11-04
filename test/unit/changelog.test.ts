import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

const script = path.resolve('scripts/changelog.mjs')
let repo: RepoFixture | undefined
afterEach(() => repo?.cleanup())

const changelog = (r: RepoFixture, ...args: string[]) => execFileSync('node', [script, ...args], { cwd: r.work, env: r.env, encoding: 'utf8' })

describe('scripts/changelog.mjs', () => {
  it('groups feat/bug commits since the previous tag and skips releases', () => {
    repo = createRepoFixture()
    repo.commitFile('a', '1', 'feat(app): old feature')
    repo.git(['tag', 'v0.1.0'])
    const fix = repo.commitFile('b', '1', 'bug(git): fix push error').slice(0, 7)
    const feat = repo.commitFile('c', '1', 'feat(update): update pill').slice(0, 7)
    repo.commitFile('d', '1', 'chore: not ours')
    repo.commitFile('e', '1', 'feat(release): v0.2.0')
    repo.git(['tag', 'v0.2.0'])

    expect(changelog(repo, 'v0.2.0')).toBe(
      `## Features\n\n- **update**: update pill (${feat})\n\n## Fixes\n\n- **git**: fix push error (${fix})\n`
    )
    expect(changelog(repo, 'v0.1.0')).toContain('- **app**: old feature')
  })

  it('says so when nothing user-facing changed', () => {
    repo = createRepoFixture()
    repo.git(['tag', 'v1.0.0'])
    repo.commitFile('a', '1', 'feat(release): v1.0.1')
    expect(changelog(repo)).toBe('No user-facing changes.\n')
  })
})
