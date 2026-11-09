import { afterEach, describe, expect, it } from 'vitest'
import { createTag, deleteTag, listTags, pushTag } from '../../src/main/git/tag'
import { createRepoFixture, type RepoFixture } from '../fixtures/repo'

describe('tags', () => {
  let fx: RepoFixture
  afterEach(() => fx?.cleanup())

  it('create lightweight + annotated, list, push, delete', async () => {
    fx = createRepoFixture()
    const first = fx.git(['rev-parse', 'HEAD'])
    const second = fx.commitFile('a.txt', 'a\n')
    await createTag(fx.work, 'v1', first, undefined, fx.env)
    await createTag(fx.work, 'v2', second, 'release two\n', fx.env)
    expect(await listTags(fx.work, fx.env)).toEqual([
      { name: 'v1', sha: first, annotated: false },
      { name: 'v2', sha: second, annotated: true }
    ])
    expect(fx.git(['tag', '-l', '--format=%(contents:subject)', 'v2'])).toBe('release two')

    await pushTag(fx.work, 'v2', { env: fx.env })
    expect(fx.git(['rev-parse', 'v2^{commit}'], fx.remote)).toBe(second)

    await deleteTag(fx.work, 'v1', fx.env)
    expect((await listTags(fx.work, fx.env)).map((t) => t.name)).toEqual(['v2'])
  })

  it('rejects bad names, unknown tags and duplicates', async () => {
    fx = createRepoFixture()
    const head = fx.git(['rev-parse', 'HEAD'])
    for (const bad of ['-f', '--delete', 'a b', 'a..b', 'x.lock', '']) await expect(createTag(fx.work, bad, head, undefined, fx.env)).rejects.toThrow('Invalid tag name')
    await expect(deleteTag(fx.work, 'nope', fx.env)).rejects.toThrow('Unknown tag')
    await expect(pushTag(fx.work, 'nope', { env: fx.env })).rejects.toThrow('Unknown tag')
    await createTag(fx.work, 'v1', head, undefined, fx.env)
    await expect(createTag(fx.work, 'v1', head, undefined, fx.env)).rejects.toThrow()
  })

  it('push without a remote fails clearly', async () => {
    fx = createRepoFixture()
    fx.git(['remote', 'remove', 'origin'])
    await createTag(fx.work, 'v1', fx.git(['rev-parse', 'HEAD']), undefined, fx.env)
    await expect(pushTag(fx.work, 'v1', { env: fx.env })).rejects.toThrow('no remote')
  })
})
