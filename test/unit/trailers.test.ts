import { describe, expect, it } from 'vitest'
import { splitTrailers, trailerLabel, trailerRole } from '../../src/renderer/src/trailers'

describe('splitTrailers', () => {
  it('splits the trailer block off the body and classifies each line', () => {
    const body = [
      '',
      'Fix the widget.',
      '',
      'Change-Id: Ie7152f0c74c598a2d6c3443c610bceac2be412cf',
      'Reviewed-on: https://cb.example.com/c/lura/dcs/+/23288',
      'Reviewed-by: Berkay van Haberal <berkay@example.com>',
      'Tested-by: Elena Lanets <elena@example.com>',
      'Bug: 123'
    ].join('\n')
    const { text, trailers } = splitTrailers(body)
    expect(text).toBe('Fix the widget.')
    expect(trailers).toEqual([
      { kind: 'changeId', key: 'Change-Id', value: 'Ie7152f0c74c598a2d6c3443c610bceac2be412cf' },
      { kind: 'url', key: 'Reviewed-on', value: 'https://cb.example.com/c/lura/dcs/+/23288' },
      { kind: 'person', key: 'Reviewed-by', value: 'Berkay van Haberal <berkay@example.com>', name: 'Berkay van Haberal', email: 'berkay@example.com' },
      { kind: 'person', key: 'Tested-by', value: 'Elena Lanets <elena@example.com>', name: 'Elena Lanets', email: 'elena@example.com' },
      { kind: 'other', key: 'Bug', value: '123' }
    ])
  })

  it('keeps a person trailer without an email', () => {
    expect(splitTrailers('Signed-off-by: Jane Q Doe').trailers).toEqual([{ kind: 'person', key: 'Signed-off-by', value: 'Jane Q Doe', name: 'Jane Q Doe' }])
  })

  it('leaves a body whose last paragraph is not all trailers untouched', () => {
    const body = 'Intro.\n\nSee: the docs\nand this line is prose\n'
    expect(splitTrailers(body)).toEqual({ text: 'Intro.\n\nSee: the docs\nand this line is prose', trailers: [] })
    expect(splitTrailers('Two words: no').trailers).toEqual([])
    expect(splitTrailers('')).toEqual({ text: '', trailers: [] })
  })

  it('handles CRLF and continuation lines', () => {
    const { text, trailers } = splitTrailers('Body.\r\n\r\nCc: A <a@x.org>\r\nNote: long\r\n  value\r\n')
    expect(text).toBe('Body.')
    expect(trailers).toEqual([
      { kind: 'person', key: 'Cc', value: 'A <a@x.org>', name: 'A', email: 'a@x.org' },
      { kind: 'other', key: 'Note', value: 'long value' }
    ])
  })
})

describe('trailerLabel', () => {
  it('sentence-cases keys', () => {
    expect(['Reviewed-by', 'Reviewed-on', 'Change-Id', 'Co-authored-by', 'Cc'].map(trailerLabel)).toEqual(['Reviewed by', 'Reviewed on', 'Change-ID', 'Co-authored by', 'Cc'])
    expect(trailerRole('Signed-off-by')).toBe('Signed-off')
  })
})
