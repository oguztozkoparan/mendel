import { chmodSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commit, setCommitMessageTransform } from '../../src/main/git/commit'
import { addChangeId, amendWithChangeId, changeIdOf, hasCommitMsgHook, unpushedCommits } from '../../src/main/providers/gerrit/git'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

const ID = /\n\nChange-Id: I[0-9a-f]{40}\n$/

describe('gerrit change-id', () => {
  let fx: RepoFixture
  afterEach(() => {
    setCommitMessageTransform(null)
    fx?.cleanup()
  })
  const stage = (name: string) => (writeFileSync(path.join(fx.work, name), `${name}\n`), fx.git(['add', name]))
  const msg = () => fx.git(['log', '-1', '--format=%B'])

  it('reads Change-Id only from the last paragraph', () => {
    const id = 'I' + 'a'.repeat(40)
    expect(changeIdOf(`s\n\nbody\n\nChange-Id: ${id}\n`)).toBe(id)
    expect(changeIdOf(`s\n\nChange-Id: ${id}\n\nmore text`)).toBeNull()
    expect(changeIdOf('s\n\nChange-Id: Ixyz')).toBeNull()
  })

  it('no hook: commit gets a Change-Id; amend keeps it; nothing is written to the hooks dir', async () => {
    fx = createRepoFixture()
    const hooks = path.join(fx.work, '.git/hooks')
    const before = readdirSync(hooks)
    setCommitMessageTransform((m, ctx) => addChangeId(ctx.cwd, m, ctx.amend, fx.env))
    stage('a.txt')
    await commit(fx.work, { summary: 'Add a', description: 'Body', amend: false }, fx.env)
    expect(msg()).toMatch(/^Add a\n\nBody\n\nChange-Id: I[0-9a-f]{40}$/)
    const id = changeIdOf(msg())
    // amend with a message that dropped the trailer still keeps HEAD's Change-Id
    await commit(fx.work, { summary: 'Add a (v2)', description: '', amend: true }, fx.env)
    expect(msg()).toBe(`Add a (v2)\n\nChange-Id: ${id}`)
    expect(readdirSync(hooks)).toEqual(before)
  })

  it('distinct commits get distinct Change-Ids', async () => {
    fx = createRepoFixture()
    stage('a.txt')
    const a = await addChangeId(fx.work, 'same\n', false, fx.env)
    fx.git(['commit', '-q', '-m', a])
    expect(a).toMatch(ID)
    stage('b.txt')
    expect(changeIdOf(await addChangeId(fx.work, 'same\n', false, fx.env))).not.toBe(changeIdOf(a))
  })

  it('existing commit-msg hook (core.hooksPath respected): message left to the hook', async () => {
    fx = createRepoFixture()
    expect(await hasCommitMsgHook(fx.work, fx.env)).toBe(false)
    const dir = path.join(fx.work, 'githooks')
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'commit-msg'), '#!/bin/sh\nprintf "\\nHooked: yes\\n" >> "$1"\n')
    chmodSync(path.join(dir, 'commit-msg'), 0o755)
    fx.git(['config', 'core.hooksPath', 'githooks'])
    expect(await hasCommitMsgHook(fx.work, fx.env)).toBe(true)
    expect(await addChangeId(fx.work, 'x\n', false, fx.env)).toBe('x\n')
    setCommitMessageTransform((m, ctx) => addChangeId(ctx.cwd, m, ctx.amend, fx.env))
    stage('a.txt')
    await commit(fx.work, { summary: 'x', description: '', amend: false }, fx.env)
    expect(msg()).toBe('x\n\nHooked: yes')
  })

  it('Add Change-Id to last commit: amends only the message of an unpushed HEAD', async () => {
    fx = createRepoFixture()
    expect(await unpushedCommits(fx.work, fx.env)).toEqual([])
    await expect(amendWithChangeId(fx.work, fx.env)).rejects.toThrow('already pushed')
    const sha = fx.commitFile('a.txt', 'a\n', 'No id\n\n#123 is not a comment')
    stage('staged.txt')
    expect((await unpushedCommits(fx.work, fx.env))[0]).toMatchObject({ sha, subject: 'No id', changeId: null })
    await amendWithChangeId(fx.work, fx.env)
    expect(msg()).toMatch(/^No id\n\n#123 is not a comment\n\nChange-Id: I[0-9a-f]{40}$/)
    expect(fx.git(['rev-list', '--count', 'HEAD'])).toBe('2')
    expect(fx.git(['diff', '--cached', '--name-only'])).toBe('staged.txt')
    expect((await unpushedCommits(fx.work, fx.env))[0].changeId).toBe(changeIdOf(msg()))
  })
})
