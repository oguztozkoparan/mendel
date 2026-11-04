import { afterEach, expect, it } from 'vitest'
import { readRemotes, usedRemotes } from '../../src/main/providers/remotes'
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

it("used remotes: the current branch's remote and origin only, tracked first (S8)", async () => {
  fx = createRepoFixture()
  fx.git(['remote', 'add', 'fork', 'https://fork.example.com/p.git'])
  fx.git(['remote', 'add', 'mirror', 'https://mirror.example.com/p.git'])
  expect((await usedRemotes(fx.work, fx.env)).map((r) => r.name)).toEqual(['origin'])
  fx.git(['config', 'branch.main.remote', 'fork'])
  expect((await usedRemotes(fx.work, fx.env)).map((r) => r.name)).toEqual(['fork', 'origin'])
  fx.git(['remote', 'remove', 'origin'])
  fx.git(['config', '--unset', 'branch.main.remote'])
  expect((await usedRemotes(fx.work, fx.env)).map((r) => r.name)).toEqual(['fork'])
})
