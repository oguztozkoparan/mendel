import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commit, setCommitMessageTransform } from '../../src/main/git/commit'
import { addChangeId, amendWithChangeId, changeIdOf, checkoutChange, hasCommitMsgHook, parsePushOutput, sendForReview, unpushedCommits, upstreamBranch } from '../../src/main/providers/gerrit/git'
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

  it("never runs the repo's trailer.<key>.cmd while adding the Change-Id (S1)", async () => {
    fx = createRepoFixture()
    const marker = path.join(fx.dir, 'trailer-cmd-ran')
    fx.git(['config', 'trailer.cid.key', 'Change-Id'])
    fx.git(['config', 'trailer.cid.cmd', `touch '${marker}'`])
    const out = await addChangeId(fx.work, 'Subject\n', false, fx.env)
    expect(out).toMatch(/^Subject\n\nChange-Id: I[0-9a-f]{40}\n$/)
    expect(existsSync(marker)).toBe(false)
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

describe('gerrit send for review', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  const withId = (name: string, n: number) => fx.commitFile(name, `${name}\n`, `Add ${name}\n\nChange-Id: I${String(n).padStart(40, '0')}`)
  const hook = (name: string, body: string) => {
    const f = path.join(fx.remote, 'hooks', name)
    writeFileSync(f, `#!/bin/sh\n${body}\n`)
    chmodSync(f, 0o755)
  }
  const refs = () => fx.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/for'], fx.remote)

  it('pushes HEAD:refs/for/<target>%topic,r,wip and parses the change URL', async () => {
    fx = createRepoFixture()
    const sha = withId('a.txt', 101)
    hook('post-receive', 'echo "" >&2; echo "New Changes:" >&2; echo "  https://gerrit.test/c/p/q/+/101 Add a.txt [NEW]" >&2')
    expect(await upstreamBranch(fx.work, fx.env)).toBe('main')
    const r = await sendForReview(fx.work, 'origin', { target: 'main', topic: 't', reviewers: ['a@b.c', 'bob'], wip: true }, { env: fx.env })
    expect(r).toEqual({ status: 'ok', url: 'https://gerrit.test/c/p/q/+/101', number: 101, updated: false })
    expect(refs()).toBe(`refs/for/main%topic=t,r=a@b.c,r=bob,wip ${sha}`)
    const plain = await sendForReview(fx.work, 'origin', { target: 'main', reviewers: [], wip: false }, { env: fx.env })
    expect(plain.status).toBe('ok')
    expect(refs()).toContain(`refs/for/main ${sha}`)
  })

  it('rejects option injection, bad targets, missing Change-Id and nothing ahead', async () => {
    fx = createRepoFixture()
    const send = (o: Partial<{ target: string; topic: string; reviewers: string[] }>) => sendForReview(fx.work, 'origin', { target: 'main', reviewers: [], wip: false, ...o }, { env: fx.env })
    await expect(send({})).rejects.toThrow('Nothing to send')
    fx.commitFile('a.txt', 'a\n', 'No id')
    await expect(send({})).rejects.toThrow('Change-Id')
    fx.git(['commit', '-q', '--amend', '-m', `Add a\n\nChange-Id: I${'1'.repeat(40)}`])
    await expect(send({ topic: 't,r=evil@x.y' })).rejects.toThrow('Invalid topic or reviewer')
    await expect(send({ reviewers: ['a b'] })).rejects.toThrow('Invalid topic or reviewer')
    await expect(send({ reviewers: ['x%wip'] })).rejects.toThrow('Invalid topic or reviewer')
    await expect(send({ target: '-main' })).rejects.toThrow('Invalid branch name')
    await expect(send({ target: 'ma..in' })).rejects.toThrow('Invalid branch name')
    expect(refs()).toBe('')
  })

  it('"no new changes" rejection is reported, not thrown', async () => {
    fx = createRepoFixture()
    withId('a.txt', 7)
    hook('pre-receive', 'echo "(no new changes)" >&2; exit 1')
    expect(await sendForReview(fx.work, 'origin', { target: 'main', reviewers: [], wip: false }, { env: fx.env })).toMatchObject({ status: 'no-changes' })
  })

  it('parsePushOutput: 3.x new / updated and 2.x outputs', () => {
    expect(parsePushOutput('remote: SUCCESS\nremote:\nremote:   https://g.example/c/p/+/1234 Fix [NEW]\n')).toEqual({ url: 'https://g.example/c/p/+/1234', number: 1234, updated: false })
    expect(parsePushOutput('remote:   https://g.example/c/p/+/1234 Fix\n')).toMatchObject({ number: 1234, updated: true })
    expect(parsePushOutput('remote: New Changes:\nremote:   https://g.example/r/1234 Fix\n')).toMatchObject({ number: 1234, updated: false })
    expect(parsePushOutput('To /tmp/remote.git\n * [new reference] HEAD -> refs/for/main')).toEqual({ url: null, number: null, updated: false })
  })
})

describe('gerrit checkout change', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())
  /** Upload a commit that changes README.md as `refs/changes/01/101/<ps>` on the bare remote; work/ stays on main. */
  const upload = (ps: number) => {
    const sha = fx.commitFile('README.md', `ps${ps}\n`, `Feature ps${ps}`)
    fx.git(['push', '-q', 'origin', `HEAD:refs/changes/01/101/${ps}`])
    fx.git(['reset', '-q', '--hard', 'origin/main'])
    return sha
  }

  it('fetches refs/changes/NN/N/P, creates change/N-psP on it tracking the change branch', async () => {
    fx = createRepoFixture()
    const sha = upload(2)
    const asked: string[] = []
    const ask = async (q: string) => (asked.push(q), true)
    expect(await checkoutChange(fx.work, 'origin', 101, 2, 'origin/main', ask, fx.env)).toBe('change/101-ps2')
    expect(fx.git(['branch', '--show-current'])).toBe('change/101-ps2')
    expect(fx.git(['rev-parse', 'HEAD'])).toBe(sha)
    expect(fx.git(['rev-parse', '--abbrev-ref', '@{upstream}'])).toBe('origin/main')
    expect(asked).toEqual([])

    // existing branch: confirm before resetting it; declining changes nothing
    fx.git(['switch', '-q', 'main'])
    expect(await checkoutChange(fx.work, 'origin', 101, 2, null, async () => false, fx.env)).toBeNull()
    expect(fx.git(['branch', '--show-current'])).toBe('main')
    expect(await checkoutChange(fx.work, 'origin', 101, 2, null, ask, fx.env)).toBe('change/101-ps2')
    expect(asked).toEqual(['replace'])
  })

  it('dirty tree conflicting with the change: stash & switch after confirm', async () => {
    fx = createRepoFixture()
    const sha = upload(1)
    writeFileSync(path.join(fx.work, 'README.md'), 'local edit\n')
    expect(await checkoutChange(fx.work, 'origin', 101, 1, null, async () => false, fx.env)).toBeNull()
    expect(fx.git(['branch', '--show-current'])).toBe('main')
    expect(await checkoutChange(fx.work, 'origin', 101, 1, null, async () => true, fx.env)).toBe('change/101-ps1')
    expect(fx.git(['rev-parse', 'HEAD'])).toBe(sha)
    expect(fx.git(['stash', 'list', '--format=%gs'])).toBe('On main: gitdock-stash')
  })

  it('rejects non-positive or non-integer numbers before running git', async () => {
    fx = createRepoFixture()
    for (const [n, ps] of [[0, 1], [1, -1], [1.5, 1]]) await expect(checkoutChange(fx.work, 'origin', n, ps, null, async () => true, fx.env)).rejects.toThrow('Invalid change')
  })
})
