/** One trailer condition: a `Key: value` line in the message. `prefix` = the value starts with `value` (Change-Id), else contains it. */
export interface TrailerMatch {
  key: string
  value: string
  prefix?: boolean
}

/** Structured History search (sent over `history:log`; main turns it into git log args). All parts are ANDed. */
export interface HistoryQuery {
  /** Message text: case-insensitive literal. */
  text?: string
  author?: string
  committer?: string
  trailers?: TrailerMatch[]
  /** Commit SHA prefix (4-40 hex). */
  sha?: string
  /** Commits touching this path (follows renames). */
  path?: string
  /** git's --before/--after date formats ("2024-01-31", "2 weeks ago"). */
  before?: string
  after?: string
}

/** Qualifiers mapped to a trailer key. */
const TRAILERS: Record<string, { key: string; prefix?: boolean }> = {
  change: { key: 'Change-Id', prefix: true },
  'reviewed-on': { key: 'Reviewed-on' },
  reviewer: { key: 'Reviewed-by' },
  'tested-by': { key: 'Tested-by' },
  'signed-off-by': { key: 'Signed-off-by' }
}
const SINGLE = ['author', 'committer', 'sha', 'path', 'before', 'after'] as const

/** Help popover rows. */
export const QUALIFIERS: [string, string][] = [
  ['author:<name or email>', 'Author'],
  ['committer:<name or email>', 'Committer'],
  ['change:<Change-Id>', 'Change-Id trailer (prefix)'],
  ['reviewed-on:<url or number>', 'Reviewed-on trailer'],
  ['reviewer:<name or email>', 'Reviewed-by trailer'],
  ['tested-by:<name>', 'Tested-by trailer'],
  ['signed-off-by:<name>', 'Signed-off-by trailer'],
  ['trailer:<Key>=<value>', 'Any trailer'],
  ['sha:<prefix>', 'Commit SHA'],
  ['path:<file or folder>', 'Commits touching a path'],
  ['before:<date>', 'Committed before ("2024-05-01", "2 weeks ago")'],
  ['after:<date>', 'Committed after'],
  ['"two words"', 'Quote values with spaces']
]

export const TRAILER_KEY = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
export const SHA_PREFIX = /^[0-9a-fA-F]{4,40}$/

/**
 * Parse the History search box: plain words (message text, joined by one space) and `key:value` qualifiers, values optionally "quoted".
 * Repeated single-valued qualifiers keep the last; trailer qualifiers add up (ANDed). Unknown qualifiers are errors: quote text like "fix:" to search it.
 */
export function parseHistoryQuery(input: string): { query: HistoryQuery; errors: string[] } {
  const query: HistoryQuery = {}
  const errors: string[] = []
  const text: string[] = []
  // key:"quoted value" | key:value | "quoted text" | word
  for (const m of input.matchAll(/([A-Za-z][A-Za-z-]*):(?:"([^"]*)"?|(\S*))|"([^"]*)"?|(\S+)/g)) {
    const [, key, quoted, bare, qtext, word] = m
    if (key === undefined) {
      const t = (qtext ?? word ?? '').trim()
      if (t) text.push(t)
      continue
    }
    const k = key.toLowerCase()
    const value = (quoted ?? bare ?? '').trim()
    const known = k in TRAILERS || k === 'trailer' || (SINGLE as readonly string[]).includes(k)
    if (!known) {
      errors.push(`Unknown qualifier ${key}: (quote it to search the text)`)
      continue
    }
    if (!value) {
      errors.push(`${k}: needs a value`)
      continue
    }
    if (k in TRAILERS) (query.trailers ??= []).push({ ...TRAILERS[k]!, value })
    else if (k === 'trailer') {
      const eq = value.indexOf('=')
      const tk = value.slice(0, eq).trim()
      const tv = value.slice(eq + 1).trim()
      if (eq < 1 || !TRAILER_KEY.test(tk) || !tv) errors.push('trailer: takes Key=value, e.g. trailer:Bug=123')
      else (query.trailers ??= []).push({ key: tk, value: tv })
    } else if (k === 'sha' && !SHA_PREFIX.test(value)) errors.push('sha: takes 4 to 40 hex characters')
    else query[k as (typeof SINGLE)[number]] = value
  }
  if (text.length) query.text = text.join(' ')
  return { query, errors }
}

/** True when the query filters anything. */
export const hasQuery = (q: HistoryQuery) => Object.values(q).some((v) => v !== undefined)
