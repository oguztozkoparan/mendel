import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { promptKind, requestAnswer, startAskpassServer, type AskpassServer } from '../../src/main/auth/askpass'
import { git, setGitEnv } from '../../src/main/git/runner'
import { basic, startAuthRemote } from '../fixtures/auth-remote'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

const helper = [process.execPath, path.resolve('test/fixtures/askpass-node.mjs')]

describe('askpass bridge', () => {
  let srv: AskpassServer | undefined
  let fx: RepoFixture | undefined
  afterEach(() => {
    setGitEnv({})
    srv?.close()
    fx?.cleanup()
  })

  it('classifies prompts', () => {
    expect(promptKind("Username for 'https://h': ")).toBe('text')
    expect(promptKind("Password for 'https://u@h': ")).toBe('secret')
    expect(promptKind("Enter passphrase for key '/k': ")).toBe('secret')
    expect(promptKind('Are you sure you want to continue connecting (yes/no/[fingerprint])? ')).toBe('confirm')
  })

  it('answers only clients with the token', async () => {
    srv = await startAskpassServer({ command: helper, onPrompt: async (p) => `got:${p}` })
    const { GITDOCK_ASKPASS_SOCKET: sock, GITDOCK_ASKPASS_TOKEN: token } = srv.env
    expect(await requestAnswer(sock, token, 'Q')).toBe('got:Q')
    expect(await requestAnswer(sock, 'wrong', 'Q')).toBeNull()
  })

  it('feeds git credentials from the prompt handler', async () => {
    fx = createRepoFixture()
    const remote = await startAuthRemote()
    const prompts: string[] = []
    srv = await startAskpassServer({
      command: helper,
      onPrompt: async (p) => (prompts.push(p), p.startsWith('Username') ? 'alice' : 's3cret')
    })
    setGitEnv(srv.env)
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
    setGitEnv(srv.env)
    try {
      const t = Date.now()
      await expect(git(['ls-remote', `${remote.url}/repo.git`], { cwd: fx.work, env: fx.env })).rejects.toMatchObject({ kind: 'AuthFailed' })
      expect(Date.now() - t).toBeLessThan(5000)
    } finally {
      await remote.close()
    }
  })
})
