/** One `Key: value` line of a commit message's trailer block. */
export type Trailer =
  | { kind: 'person'; key: string; value: string; name: string; email?: string }
  | { kind: 'changeId' | 'url' | 'other'; key: string; value: string }

const LINE = /^([A-Za-z0-9][A-Za-z0-9-]*):[ \t]*(\S.*)$/
const PERSON = /^(.*?)\s*<([^<>\s]+)>$/

/** Splits a commit body (message without the summary line) into its text and the trailing trailer block (git's rule: the last paragraph, every line `Key: value`, indented lines continue the previous value). */
export function splitTrailers(body: string): { text: string; trailers: Trailer[] } {
  const lines = body.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n')
  let start = lines.length
  while (start > 0 && lines[start - 1]!.trim()) start--
  const block = lines.slice(start)
  const raw: { key: string; value: string }[] = []
  for (const l of block) {
    const m = LINE.exec(l)
    if (m) raw.push({ key: m[1]!, value: m[2]!.trim() })
    else if (/^\s/.test(l) && raw.length) raw[raw.length - 1]!.value += ' ' + l.trim()
    else return { text: lines.join('\n').trim(), trailers: [] }
  }
  if (!raw.length) return { text: lines.join('\n').trim(), trailers: [] }
  return { text: lines.slice(0, start).join('\n').trim(), trailers: raw.map(classify) }
}

function classify({ key, value }: { key: string; value: string }): Trailer {
  const k = key.toLowerCase()
  if (k === 'change-id') return { kind: 'changeId', key, value }
  if (/^https?:\/\/\S+$/.test(value)) return { kind: 'url', key, value }
  const m = PERSON.exec(value)
  if (m && m[2]!.includes('@')) return { kind: 'person', key, value, name: m[1] || m[2]!, email: m[2] }
  if (k.endsWith('-by') || k === 'cc') return { kind: 'person', key, value, name: value }
  return { kind: 'other', key, value }
}

/** Sentence-case group label: "Reviewed-by" -> "Reviewed by", "Change-Id" -> "Change-ID". */
export const trailerLabel = (key: string) =>
  key
    .replace(/-(by|on|to)$/i, ' $1')
    .replace(/^(.)(.*)$/, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase())
    .replace(/\bid$/, 'ID')

/** Role word of a person trailer: "Reviewed-by" -> "Reviewed", "Cc" -> "Cc". */
export const trailerRole = (key: string) => trailerLabel(key).replace(/ by$/, '')
