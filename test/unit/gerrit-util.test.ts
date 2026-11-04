import { expect, it } from 'vitest'
import { abbrev, gerritDate, labelSummary } from '../../src/renderer/src/providers/gerrit/util'

it('summarizes labels as highest/lowest vote', () => {
  expect(labelSummary({ 'Code-Review': { all: [{ value: 2 }, { value: -1 }, { value: 0 }] }, Verified: { all: [{ value: 1 }] }, 'Library-Compliance': { all: [] } })).toEqual(['CR +2/−1', 'V +1'])
  expect(abbrev('Code-Review')).toBe('CR')
  expect(gerritDate('2026-11-03 10:00:00.000000000').toISOString()).toBe('2026-11-03T10:00:00.000Z')
})
