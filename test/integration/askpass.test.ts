import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { promptContext, promptKind, requestAnswer, startAskpassServer, type AskpassServer } from '../../src/main/auth/askpass'
import { git, setGitEnv } from '../../src/main/git/runner'
import { basic, startAuthRemote } from '../fixtures/auth-remote'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

const helper = [process.execPath, path.resolve('test/fixtures/askpass-node.mjs')]

describe('askpass bridge', () => {
  let srv: AskpassServer | undefined
  let fx: RepoFixture | undefined
  afterEach(() => {
    setGitEnv(null)
    srv?.close()
    fx?.cleanup()
  })

  it('classifies prompts', () => {
    expect(promptKind("Username for 'https://h': ")).toBe('text')
    expect(promptKind("Password for 'https://u@h': ")).toBe('secret')
    expect(promptKind("Enter passphrase for key '/k': ")).toBe('secret')
    expect(promptKind('Are you sure you want to continue connecting (yes/no/[fingerprint])? ')).toBe('confirm')
  })

  it('answers only clients with a live per-op token, and names the op (S5)', async () => {
    const origins: string[] = []
    srv = await startAskpassServer({ command: helper, onPrompt: async (p, o) => (origins.push(promptContext(o)), `got:${p}`) })
    const op = srv.issue({ cwd: '/r', args: ['-c', 'x=y', 'fetch', 'origin'] })
    const { GITDOCK_ASKPASS_SOCKET: sock, GITDOCK_ASKPASS_TOKEN: token } = op.env
    expect(await requestAnswer(sock, token, 'Q')).toBe('got:Q')
    expect(origins).toEqual(['git fetch in /r'])
    expect(await requestAnswer(sock, 'wrong', 'Q')).toBeNull()
    expect(srv.issue({ cwd: '/r', args: [] }).env.GITDOCK_ASKPASS_TOKEN).not.toBe(token)
    op.revoke()
    expect(await requestAnswer(sock, token, 'Q')).toBeNull()
  })

  it('revoking the op settles its open prompt with null (R15)', async () => {
    let aborted = false
    srv = await startAskpassServer({
      command: helper,
      onPrompt: (_p, _o, signal) => new Promise((resolve) => signal.addEventListener('abort', () => ((aborted = true), resolve(null))))
    })
    const op = srv.issue({ cwd: '/r', args: ['push'] })
    const answer = requestAnswer(op.env.GITDOCK_ASKPASS_SOCKET, op.env.GITDOCK_ASKPASS_TOKEN, 'Password: ')
    await new Promise((r) => setTimeout(r, 100))
    op.revoke()
    expect(await answer).toBeNull()
    expect(aborted).toBe(true)
  })

  it('no token reaches git after it exited: each run gets its own, revoked on exit', async () => {
    fx = createRepoFixture()
    srv = await startAskpassServer({ command: helper, onPrompt: async () => 'x' })
    const tokens: string[] = []
    setGitEnv((o) => {
      const op = srv!.issue(o)
      tokens.push(op.env.GITDOCK_ASKPASS_TOKEN)
      return op
    })
    await git(['--version'], { cwd: fx.work, env: fx.env })
    await git(['--version'], { cwd: fx.work, env: fx.env })
    expect(new Set(tokens).size).toBe(2)
    expect(await requestAnswer(srv.issue({ cwd: '', args: [] }).env.GITDOCK_ASKPASS_SOCKET, tokens[0], 'Q')).toBeNull()
  })

  it('feeds git credentials from the prompt handler', async () => {
    fx = createRepoFixture()
    const remote = await startAuthRemote()
    const prompts: string[] = []
    srv = await startAskpassServer({
      command: helper,
      onPrompt: async (p) => (prompts.push(p), p.startsWith('Username') ? 'alice' : 's3cret')
    })
    setGitEnv(srv.issue)
    try {
      const err = await git(['ls-remote', `${remote.url}/repo.git`], { cwd: fx.work, env: fx.env }).catch((e: unknown) => e)
      expect(err).toMatchObject({ kind: 'AuthFailed' })
      expect(prompts).toEqual([`Username for '${remote.url}': `, `Password for '${remote.url.replace('//', '//alice@')}': `])
      expect(remote.requests.some((r) => r.headers.authorization === basic('alice', 's3cret'))).toBe(true)
    } finally {
      await remote.close()
    }
  })

  it('cancel makes git fail fast with AuthFailed', async () => {
    fx = createRepoFixture()
    const remote = await startAuthRemote()
    srv = await startAskpassServer({ command: helper, onPrompt: async () => null })
    setGitEnv(srv.issue)
    try {
      const t = Date.now()
      await expect(git(['ls-remote', `${remote.url}/repo.git`], { cwd: fx.work, env: fx.env })).rejects.toMatchObject({ kind: 'AuthFailed' })
      expect(Date.now() - t).toBeLessThan(5000)
    } finally {
      await remote.close()
    }
  })
})
