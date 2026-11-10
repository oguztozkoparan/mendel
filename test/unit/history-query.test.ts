import { describe, expect, it } from 'vitest'
import { hasQuery, parseHistoryQuery } from '../../src/shared/historyQuery'

describe('parseHistoryQuery', () => {
  it('plain words are one message phrase', () => {
    expect(parseHistoryQuery('  fix   parser ')).toEqual({ query: { text: 'fix parser' }, errors: [] })
    expect(parseHistoryQuery('')).toEqual({ query: {}, errors: [] })
    expect(hasQuery(parseHistoryQuery('').query)).toBe(false)
  })

  it('qualifiers, quoted values and trailers', () => {
    const { query, errors } = parseHistoryQuery('crash author:"Elena Lanets" committer:bot change:I8a3 reviewer:jane reviewed-on:1234 tested-by:ci signed-off-by:x trailer:Bug=42 sha:ABCD12 path:src/a.ts before:"2 weeks ago" after:2024-01-01 "two words"')
    expect(errors).toEqual([])
    expect(query).toEqual({
      text: 'crash two words',
      author: 'Elena Lanets',
      committer: 'bot',
      sha: 'ABCD12',
      path: 'src/a.ts',
      before: '2 weeks ago',
      after: '2024-01-01',
      trailers: [
        { key: 'Change-Id', value: 'I8a3', prefix: true },
        { key: 'Reviewed-by', value: 'jane' },
        { key: 'Reviewed-on', value: '1234' },
        { key: 'Tested-by', value: 'ci' },
        { key: 'Signed-off-by', value: 'x' },
        { key: 'Bug', value: '42' }
      ]
    })
    expect(hasQuery(query)).toBe(true)
  })

  it('keys are case-insensitive; repeated single qualifiers keep the last', () => {
    expect(parseHistoryQuery('Author:a author:b').query).toEqual({ author: 'b' })
  })

  it('errors: unknown qualifier, empty value, bad trailer, bad sha', () => {
    expect(parseHistoryQuery('fix: crash').errors).toEqual(['Unknown qualifier fix: (quote it to search the text)'])
    expect(parseHistoryQuery('"fix: crash"')).toEqual({ query: { text: 'fix: crash' }, errors: [] })
    expect(parseHistoryQuery('author:').errors).toEqual(['author: needs a value'])
    expect(parseHistoryQuery('trailer:Bug').errors).toHaveLength(1)
    expect(parseHistoryQuery('trailer:=x').errors).toHaveLength(1)
    expect(parseHistoryQuery('trailer:a b=c').errors).toHaveLength(1)
    expect(parseHistoryQuery('sha:xyz1').errors).toEqual(['sha: takes 4 to 40 hex characters'])
    expect(parseHistoryQuery('sha:abc').errors).toHaveLength(1)
  })

  it('text that is not a qualifier stays text', () => {
    expect(parseHistoryQuery('feat(ui): menus -author').query).toEqual({ text: 'feat(ui): menus -author' })
  })
})
