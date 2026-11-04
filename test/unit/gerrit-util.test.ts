import { expect, it } from 'vitest'
import { reviewRef } from '../../src/shared/gerrit'
import { abbrev, gerritDate, labelSummary } from '../../src/renderer/src/providers/gerrit/util'

it('summarizes labels as highest/lowest vote', () => {
  expect(labelSummary({ 'Code-Review': { all: [{ value: 2 }, { value: -1 }, { value: 0 }] }, Verified: { all: [{ value: 1 }] }, 'Library-Compliance': { all: [] } })).toEqual(['CR +2/−1', 'V +1'])
  // o=LABELS (Reviews list): no per-reviewer votes, only who approved/rejected/recommended/disliked.
  const a = { _account_id: 1 }
  expect(labelSummary({ 'Code-Review': { approved: a, disliked: a }, Verified: { rejected: a }, 'Library-Compliance': {} })).toEqual(['CR ✓/−1', 'V ✗'])
  expect(abbrev('Code-Review')).toBe('CR')
  expect(gerritDate('2026-11-03 10:00:00.000000000').toISOString()).toBe('2026-11-03T10:00:00.000Z')
})

it('turns Gerrit diff blocks into parseable unified hunks', async () => {
  const { diffText } = await import('../../src/renderer/src/providers/gerrit/util')
  expect(diffText({ meta_a: { name: 'f' }, meta_b: { name: 'f' }, content: [{ ab: ['x'] }, { a: ['old'], b: ['new', 'new2'] }, { skip: 10 }, { ab: ['y'] }, { b: ['z'] }] })).toBe(
    'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,3 @@\n x\n-old\n+new\n+new2\n@@ -13,1 +14,2 @@\n y\n+z\n'
  )
  expect(diffText({ meta_b: { name: 'f' }, content: [{ b: ['a', 'b'] }] })).toBe('diff --git a/f b/f\n--- /dev/null\n+++ b/f\n@@ -0,0 +1,2 @@\n+a\n+b\n')
})

it('groups comments into threads by in_reply_to', async () => {
  const { threadsOf } = await import('../../src/renderer/src/providers/gerrit/util')
  const c = (id: string, updated: string, in_reply_to?: string) => ({ id, updated, in_reply_to })
  const t = threadsOf([c('r2', '2'), c('a3', '5', 'a2'), c('a1', '1'), c('a2', '3', 'a1'), c('x', '4', 'missing')])
  expect(t.map((th) => th.map((x) => x.id))).toEqual([['a1', 'a2', 'a3'], ['r2'], ['x']])
})

it('reviewRef rejects push-option separators in the target branch (S4)', () => {
  expect(reviewRef('main', { reviewers: ['a@b.c'], wip: true })).toBe('refs/for/main%r=a@b.c,wip')
  for (const t of ['main%r=x', 'a,b', 'a=b']) expect(() => reviewRef(t, { reviewers: [], wip: false })).toThrow(/Invalid target branch/)
})
