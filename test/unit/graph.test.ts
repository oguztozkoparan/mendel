import { describe, expect, it } from 'vitest'
import { graphRows } from '../../src/renderer/src/graph'

const c = (sha: string, ...parents: string[]) => ({ sha, parents })

describe('graphRows', () => {
  it('lays a linear history on one lane', () => {
    const { rows, state } = graphRows([c('c', 'b'), c('b', 'a'), c('a')])
    expect(rows).toEqual([
      { col: 0, merge: false, into: [], out: [0], pass: [] },
      { col: 0, merge: false, into: [0], out: [0], pass: [] },
      { col: 0, merge: false, into: [0], out: [], pass: [] }
    ])
    expect(state.lanes).toEqual([])
  })

  it('forks a branch lane at a merge and joins it at the fork point', () => {
    // m merges side branch y (on x) into main (b); both fork from a.
    const { rows } = graphRows([c('m', 'b', 'y'), c('y', 'x'), c('b', 'a'), c('x', 'a'), c('a')])
    expect(rows).toEqual([
      { col: 0, merge: true, into: [], out: [0, 1], pass: [] },
      { col: 1, merge: false, into: [1], out: [1], pass: [0] },
      { col: 0, merge: false, into: [0], out: [0], pass: [1] },
      { col: 1, merge: false, into: [1], out: [1], pass: [0] },
      // both lanes wait for a: they join into its dot
      { col: 0, merge: false, into: [0, 1], out: [], pass: [] }
    ])
  })

  it('opens one lane per extra parent of an octopus merge', () => {
    const { rows } = graphRows([c('o', 'p1', 'p2', 'p3'), c('p3', 'r'), c('p2', 'r'), c('p1', 'r'), c('r')])
    expect(rows[0]).toEqual({ col: 0, merge: true, into: [], out: [0, 1, 2], pass: [] })
    expect(rows[1]).toEqual({ col: 2, merge: false, into: [2], out: [2], pass: [0, 1] })
    expect(rows[4]).toEqual({ col: 0, merge: false, into: [0, 1, 2], out: [], pass: [] })
  })

  it('reuses a lane that already waits for a merge parent', () => {
    // t2 and m both point at s: the merge line joins the existing lane, no new one.
    const { rows } = graphRows([c('t2', 's'), c('m', 'a', 's'), c('s', 'a'), c('a')])
    expect(rows[1]).toEqual({ col: 1, merge: true, into: [], out: [1, 0], pass: [0] })
  })

  it('opens no lane for a parent already listed above its child', () => {
    // date order put a before x: x's line must not wait for a forever
    const { rows, state } = graphRows([c('m', 'b', 'x'), c('b', 'a'), c('a'), c('x', 'a')])
    expect(rows[3]).toEqual({ col: 1, merge: false, into: [1], out: [], pass: [] })
    expect(state.lanes).toEqual([])
  })

  it('continues across pages exactly like one pass', () => {
    const all = [c('m', 'b', 'y'), c('y', 'x'), c('b', 'a'), c('x', 'a'), c('a')]
    const whole = graphRows(all)
    const first = graphRows(all.slice(0, 2))
    const second = graphRows(all.slice(2), first.state)
    expect([...first.rows, ...second.rows]).toEqual(whole.rows)
    expect(second.state).toEqual(whole.state)
  })
})
