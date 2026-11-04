import { expect, it } from 'vitest'
import { abbrev, gerritDate, labelSummary } from '../../src/renderer/src/providers/gerrit/util'

it('summarizes labels as highest/lowest vote', () => {
  expect(labelSummary({ 'Code-Review': { all: [{ value: 2 }, { value: -1 }, { value: 0 }] }, Verified: { all: [{ value: 1 }] }, 'Library-Compliance': { all: [] } })).toEqual(['CR +2/−1', 'V +1'])
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
