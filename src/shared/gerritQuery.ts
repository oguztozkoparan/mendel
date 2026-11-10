// Reviews History search (PLAN.md §3.7): the search box is parsed here into allow-listed operator/value pairs;
// main (providers/gerrit/client.ts gerritSearchQuery) quotes and escapes every value. Raw Gerrit query text never crosses IPC.

/** Gerrit search operators the History search may send (all available in Gerrit 3.1). */
export const GERRIT_OPS = ['owner', 'reviewer', 'author', 'committer', 'status', 'project', 'branch', 'topic', 'hashtag', 'change', 'file', 'label', 'is', 'before', 'after', 'age'] as const
export type GerritOp = (typeof GERRIT_OPS)[number]

export interface GerritSearchTerm {
  op: GerritOp
  value: string
}

/** Structured Reviews History search (sent over `gerrit:search`). All parts are ANDed. */
export interface GerritSearch {
  /** Plain words: `message:"…"`. */
  text?: string
  terms?: GerritSearchTerm[]
}

export const GERRIT_STATUS = ['open', 'merged', 'abandoned', 'closed'] as const
export const GERRIT_IS = ['open', 'closed', 'merged', 'abandoned', 'wip', 'private', 'reviewed', 'starred', 'watched', 'owner', 'reviewer', 'mergeable', 'submittable'] as const
export const MAX_TERM = 200
export const MAX_TEXT = 500
export const MAX_TERMS = 20

/** Help popover rows. */
export const GERRIT_QUALIFIERS: [string, string][] = [
  ['owner:<name, email or self>', 'Change owner'],
  ['reviewer:<name, email or self>', 'Reviewer'],
  ['author:<name or email>', 'Commit author'],
  ['committer:<name or email>', 'Committer'],
  ['status:<state>', 'open, merged, abandoned, closed'],
  ['project:<name>', 'Project'],
  ['branch:<name>', 'Target branch'],
  ['topic:<name>', 'Topic'],
  ['hashtag:<tag>', 'Hashtag'],
  ['change:<number or Change-Id>', 'Change'],
  ['file:<path>', 'Touches a file'],
  ['label:<Label=value>', 'Vote, e.g. Code-Review=+2'],
  ['is:<state>', 'wip, reviewed, starred, private, …'],
  ['before:<date>', 'Updated before ("2024-05-01")'],
  ['after:<date>', 'Updated after'],
  ['age:<age>', 'Not updated for, e.g. 2d, 1w'],
  ['"two words"', 'Quote values with spaces']
]

/** Why `value` is not allowed for `op`, or null. Shared by the parser (inline hint) and main (rejects before building). */
export function termError(op: GerritOp, value: string): string | null {
  if (!value) return `${op}: needs a value`
  if (value.length > MAX_TERM) return `${op}: is too long`
  if (/[\0-\x1f\x7f]/.test(value)) return `${op}: contains control characters`
  if (op === 'status' && !(GERRIT_STATUS as readonly string[]).includes(value)) return `status: takes ${GERRIT_STATUS.join(', ')}`
  if (op === 'is' && !(GERRIT_IS as readonly string[]).includes(value)) return `is: takes ${GERRIT_IS.join(', ')}`
  if (op === 'change' && !/^(?:\d{1,10}|I[0-9a-fA-F]{1,40})$/.test(value)) return 'change: takes a number or a Change-Id (I…)'
  if (op === 'label' && !/^[A-Za-z0-9_-]+(?:(?:[<>]=?|=)[+-]?\d+|=[A-Za-z]+)?$/.test(value)) return 'label: takes Label=value, e.g. Code-Review=+2'
  if (op === 'age' && !/^\d+\s*[A-Za-z]+$/.test(value)) return 'age: takes e.g. 2d, 3w'
  return null
}

/**
 * Parse the Reviews History search box: plain words (message text) and `key:value` qualifiers, values optionally "quoted".
 * Every qualifier is kept (ANDed). Unknown qualifiers are errors: quote text like "fix:" to search it.
 */
export function parseGerritSearch(input: string): { query: GerritSearch; errors: string[] } {
  const query: GerritSearch = {}
  const errors: string[] = []
  const text: string[] = []
  for (const m of input.matchAll(/([A-Za-z][A-Za-z-]*):(?:"([^"]*)"?|(\S*))|"([^"]*)"?|(\S+)/g)) {
    const [, key, quoted, bare, qtext, word] = m
    if (key === undefined) {
      const t = (qtext ?? word ?? '').trim()
      if (t) text.push(t)
      continue
    }
    const op = key.toLowerCase() as GerritOp
    const value = (quoted ?? bare ?? '').trim()
    if (!GERRIT_OPS.includes(op)) {
      errors.push(`Unknown qualifier ${key}: (quote it to search the text)`)
      continue
    }
    const err = termError(op, op === 'status' || op === 'is' ? value.toLowerCase() : value)
    if (err) errors.push(err)
    else (query.terms ??= []).push({ op, value: op === 'status' || op === 'is' ? value.toLowerCase() : value })
  }
  if (text.length) query.text = text.join(' ')
  if (query.text && query.text.length > MAX_TEXT) errors.push('Search text is too long')
  if ((query.terms?.length ?? 0) > MAX_TERMS) errors.push(`At most ${MAX_TERMS} qualifiers`)
  return { query, errors }
}
