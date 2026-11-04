import { afterEach, expect, it } from 'vitest'
import { readRemotes } from '../../src/main/providers/remotes'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

let fx: RepoFixture
afterEach(() => fx?.cleanup())

it('reads configured remote urls (not insteadOf-rewritten), origin first', async () => {
  fx = createRepoFixture()
  fx.git(['remote', 'add', 'aaa', 'ssh://u@review.example.com:29418/p/q'])
  fx.git(['config', '--global', `url.${fx.remote}.insteadOf`, 'https://gerrit.test/project'])
  fx.git(['remote', 'set-url', 'origin', 'https://gerrit.test/project'])
  const rs = await readRemotes(fx.work, fx.env)
  expect(rs.map((r) => [r.name, r.host, r.port])).toEqual([
    ['origin', 'gerrit.test', undefined],
    ['aaa', 'review.example.com', 29418]
  ])
})
