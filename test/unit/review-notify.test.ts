import { describe, expect, it } from 'vitest'
import { freshIncoming } from '../../src/main/review-notify'
import type { GerritChange } from '../../src/shared/gerrit'

const ch = (n: number) => ({ _number: n, subject: `s${n}`, project: 'p' }) as GerritChange

describe('review notifications', () => {
  it('first poll of a host notifies nothing', () => {
    expect(freshIncoming(undefined, [ch(1), ch(2)])).toEqual([])
  })
  it('only changes not seen at the last poll', () => {
    expect(freshIncoming([1, 3], [ch(1), ch(2), ch(3), ch(4)]).map((c) => c._number)).toEqual([2, 4])
    expect(freshIncoming([], [])).toEqual([])
  })
})
