import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gerritClient, gerritSearchQuery } from '../../src/main/providers/gerrit/client'
import { parseGerritSearch } from '../../src/shared/gerritQuery'
import { invoke } from '../../src/shared/ipc'
import { defaultChanges, startGerritMock, type GerritMock } from '../fixtures/gerrit-mock'

describe('parseGerritSearch', () => {
  it('plain words, qualifiers and quoted values; repeated qualifiers add up', () => {
    const { query, errors } = parseGerritSearch('crash owner:"Ada Reviewer" STATUS:Merged label:Code-Review=+2 change:I8a3 change:123 is:WIP age:2d before:"2024-05-01 10:00" reviewer:self reviewer:ada "two words"')
    expect(errors).toEqual([])
    expect(query).toEqual({
      text: 'crash two words',
      terms: [
        { op: 'owner', value: 'Ada Reviewer' },
        { op: 'status', value: 'merged' },
        { op: 'label', value: 'Code-Review=+2' },
        { op: 'change', value: 'I8a3' },
        { op: 'change', value: '123' },
        { op: 'is', value: 'wip' },
        { op: 'age', value: '2d' },
        { op: 'before', value: '2024-05-01 10:00' },
        { op: 'reviewer', value: 'self' },
        { op: 'reviewer', value: 'ada' }
      ]
    })
    expect(parseGerritSearch('')).toEqual({ query: {}, errors: [] })
  })

  it('rejects unknown qualifiers and values outside the allow-lists', () => {
    expect(parseGerritSearch('fix: x').errors).toEqual(['Unknown qualifier fix: (quote it to search the text)'])
    expect(parseGerritSearch('"fix:" x')).toEqual({ query: { text: 'fix: x' }, errors: [] })
    expect(parseGerritSearch('message:x limit:5 visibleto:x').errors).toHaveLength(3)
    expect(parseGerritSearch('status:draft').errors[0]).toMatch(/^status: takes/)
    expect(parseGerritSearch('is:attention').errors[0]).toMatch(/^is: takes/)
    expect(parseGerritSearch('change:abc').errors[0]).toMatch(/^change:/)
    expect(parseGerritSearch('label:"CR OR owner:x"').errors[0]).toMatch(/^label:/)
    expect(parseGerritSearch('owner:').errors).toEqual(['owner: needs a value'])
    expect(parseGerritSearch('owner:' + 'x'.repeat(201)).errors).toEqual(['owner: is too long'])
  })
})

describe('gerritSearchQuery (main)', () => {
  it('quotes every value, escapes " and \\, plain text → message:', () => {
    expect(gerritSearchQuery({ text: 'say "hi" \\o/', terms: [{ op: 'owner', value: 'a" OR status:open' }, { op: 'status', value: 'merged' }] }, 'p/q')).toBe(
      'project:"p/q" message:"say \\"hi\\" \\\\o/" owner:"a\\" OR status:open" status:"merged"'
    )
    expect(gerritSearchQuery({}, null)).toBe('status:open OR status:closed')
    expect(gerritSearchQuery({}, 'p/q')).toBe('project:"p/q"')
  })

  it('rejects disallowed values even if they bypass the parser', () => {
    expect(() => gerritSearchQuery({ terms: [{ op: 'status', value: 'open OR x' }] }, null)).toThrow(/^status: takes/)
    expect(() => gerritSearchQuery({ terms: [{ op: 'owner', value: 'a\nb' }] }, null)).toThrow('control characters')
  })

  it('IPC schema allows only known operators and capped lengths', () => {
    const ok = (query: unknown, start = 0) => invoke['gerrit:search'].req.safeParse({ repo: '/r', projectOnly: true, start, query }).success
    expect(ok({ text: 'x', terms: [{ op: 'owner', value: 'self' }] })).toBe(true)
    expect(ok({ terms: [{ op: 'limit', value: '5' }] })).toBe(false)
    expect(ok({ raw: 'owner:self' })).toBe(false)
    expect(ok({ text: 'x'.repeat(501) })).toBe(false)
    expect(ok({ terms: Array.from({ length: 21 }, () => ({ op: 'owner', value: 'a' })) })).toBe(false)
    expect(ok({}, -1)).toBe(false)
  })
})

describe('gerrit client search', () => {
  let mock: GerritMock
  beforeAll(async () => {
    const base = defaultChanges()
    const old = base.find((c) => c._number === 90)!
    const extra = Array.from({ length: 60 }, (_, i) => ({ ...old, _number: 200 + i, subject: `Old change ${i}`, updated: `2026-09-${String((i % 28) + 1).padStart(2, '0')} 10:00:00.000000000` }))
    mock = await startGerritMock({ changes: [...base, ...extra] })
  })
  afterAll(() => mock.close())
  const client = () => gerritClient(mock.url, { username: mock.username, password: mock.password }, fetch)

  it('pages with n/S and _more_changes, newest first', async () => {
    const p1 = await client().search({}, 'p/q', 0)
    expect(p1.changes).toHaveLength(50)
    expect(p1.more).toBe(true)
    expect(p1.changes.slice(0, 2).map((c) => c._number)).toEqual([103, 101])
    expect('_more_changes' in p1.changes[49]).toBe(false)
    const url = new URL(mock.find('GET', '/a/changes/').at(-1)!.url, 'http://x')
    expect(url.searchParams.get('q')).toBe('project:"p/q"')
    expect([url.searchParams.get('n'), url.searchParams.get('S'), url.searchParams.getAll('o')]).toEqual(['50', '0', ['LABELS', 'DETAILED_ACCOUNTS']])
    const p2 = await client().search({}, 'p/q', 50)
    expect(p2.more).toBe(false)
    expect(p2.changes).toHaveLength(63 - 50)
  })

  it('sends the built query', async () => {
    const r = await client().search({ terms: [{ op: 'owner', value: 'self' }, { op: 'status', value: 'merged' }] }, null, 0)
    expect(r.changes.map((c) => c._number)).toContain(90)
    expect(r.changes.every((c) => c.status === 'MERGED')).toBe(true)
    expect(new URL(mock.find('GET', '/a/changes/').at(-1)!.url, 'http://x').searchParams.get('q')).toBe('owner:"self" status:"merged"')
  })
})
