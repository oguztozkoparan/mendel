import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commit, commitInfo, formatMessage, setCommitMessageTransform } from '../../src/main/git/commit'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('formatMessage', () => {
  it('joins summary and description with a blank line', () => {
    expect(formatMessage(' Fix it ', 'Line 1\n\nLine 2\n\n')).toBe('Fix it\n\nLine 1\n\nLine 2\n')
    expect(formatMessage('Only summary', '  \n')).toBe('Only summary\n')
  })
})

describe('commit', () => {
  let fx: RepoFixture
  afterEach(() => {
    setCommitMessageTransform(null)
    fx?.cleanup()
  })
  const count = () => fx.git(['rev-list', '--count', 'HEAD'])

  it('commits summary + description via stdin and reports info', async () => {
    fx = createRepoFixture()
    writeFileSync(path.join(fx.work, 'a.txt'), 'a\n')
    fx.git(['add', 'a.txt'])
    await commit(fx.work, { summary: 'Add a', description: '# not a comment\n-not an option', amend: false }, fx.env)
    expect(fx.git(['log', '-1', '--format=%B'])).toBe('Add a\n\n# not a comment\n-not an option')
    expect(await commitInfo(fx.work, fx.env)).toEqual({ branch: 'main', author: 'Test User <test@example.com>', head: 'Add a\n\n# not a comment\n-not an option' })
  })

  it('amend replaces HEAD without adding a commit', async () => {
    fx = createRepoFixture()
    fx.commitFile('a.txt', 'a\n', 'first')
    const before = count()
    const oldHead = fx.git(['rev-parse', 'HEAD'])
    await commit(fx.work, { summary: 'reworded', description: '', amend: true }, fx.env)
    expect(count()).toBe(before)
    expect(fx.git(['rev-parse', 'HEAD'])).not.toBe(oldHead)
    expect(fx.git(['log', '-1', '--format=%B'])).toBe('reworded')
  })

  it('failing commit-msg hook rejects with the hook output', async () => {
    fx = createRepoFixture()
    const hook = path.join(fx.work, '.git/hooks/commit-msg')
    writeFileSync(hook, '#!/bin/sh\necho "hook says no" >&2\nexit 1\n')
    chmodSync(hook, 0o755)
    writeFileSync(path.join(fx.work, 'a.txt'), 'a\n')
    fx.git(['add', 'a.txt'])
    await expect(commit(fx.work, { summary: 's', description: '', amend: false }, fx.env)).rejects.toMatchObject({ message: expect.stringContaining('hook says no') })
  })

  it('applies the provider message transform', async () => {
    fx = createRepoFixture()
    setCommitMessageTransform(async (m, ctx) => `${m}\nTrailer: ${ctx.amend}\n`)
    await commit(fx.work, { summary: 'x', description: '', amend: true }, fx.env)
    expect(fx.git(['log', '-1', '--format=%B'])).toBe('x\n\nTrailer: true')
  })

  it('info before the first commit', async () => {
    fx = createRepoFixture()
    fx.git(['checkout', '-q', '--orphan', 'fresh'])
    expect(await commitInfo(fx.work, fx.env)).toMatchObject({ branch: 'fresh', head: null })
  })
})
