import { describe, expect, it } from 'vitest'
import type { Probe } from '../../src/main/providers'
import { githubProvider } from '../../src/main/providers/github/detect'
import { parseRemote } from '../../src/main/providers/remotes'

const noProbe: Probe = async (url) => expect.fail(`probed ${url}`)
const detect = (...urls: string[]) => githubProvider.detect(urls.map((u, i) => parseRemote(i ? `r${i}` : 'origin', u)!), noProbe)

describe('github detection', () => {
  it.each([
    ['https://github.com/o/r.git', 'github.com'],
    ['https://GitHub.com/o/r', 'github.com'],
    ['ssh://git@github.com/o/r.git', 'github.com'],
    ['git@github.com:o/r.git', 'github.com'],
    ['ssh://git@ssh.github.com:443/o/r.git', 'ssh.github.com']
  ])('%s → o/r', async (url, host) => {
    expect(await detect(url)).toEqual({ provider: 'github', remote: 'origin', host, baseUrl: 'https://api.github.com', project: 'o/r' })
  })

  it('keeps allowed characters in owner and repo', async () => {
    expect(await detect('git@github.com:my-org_1/re.po-x_2.git')).toMatchObject({ project: 'my-org_1/re.po-x_2' })
  })

  it.each([
    'https://github.example.com/o/r.git',
    'https://github.com.evil.example/o/r.git',
    'https://notgithub.com/o/r.git',
    'https://github.com/o.git',
    'https://github.com/o/r/x.git',
    'git@github.com:o/..',
    'git@github.com:../r.git',
    'https://github.com/o/r%20x.git',
    'git@github.com:o/r$.git',
    '/local/github.com/o/r'
  ])('%s → not GitHub', async (url) => {
    expect(await detect(url)).toBeNull()
  })

  it('first matching remote wins', async () => {
    expect(await detect('https://gitlab.com/x/y.git', 'git@github.com:a/b.git', 'https://github.com/c/d.git')).toMatchObject({ remote: 'r1', project: 'a/b' })
  })
})
