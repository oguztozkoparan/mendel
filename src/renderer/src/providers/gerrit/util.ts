import type { GerritChange, GerritDiff, GerritLabel } from '../../../../shared/gerrit'

/** Gerrit timestamps are UTC "2026-11-03 10:00:00.000000000". */
export const gerritDate = (s: string): Date => new Date(s.replace(' ', 'T').slice(0, 23) + 'Z')
export const shortDate = (s: string): string => gerritDate(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })

/** "+2", "−1", "0" (typographic minus). */
export const fmtVote = (v: number): string => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0')
/** "Code-Review" → "CR". */
export const abbrev = (label: string): string => label.split(/[-_ ]/).map((w) => w[0] ?? '').join('').toUpperCase()

/**
 * Per label: highest and lowest vote. DETAILED_LABELS (`all`, change detail): numbers, e.g. "CR +2/−1", "V +1".
 * LABELS (lists, PLAN.md §5.5): like Gerrit's dashboard, ✓ approved / ✗ rejected (max/min vote), +1/−1 recommended/disliked.
 */
export function labelSummary(labels: Record<string, GerritLabel> | undefined): string[] {
  return Object.entries(labels ?? {}).flatMap(([name, l]) => {
    const votes = (l.all ?? []).map((v) => v.value ?? 0)
    const up = l.all ? (Math.max(0, ...votes) > 0 ? fmtVote(Math.max(...votes)) : '') : l.approved ? '✓' : l.recommended ? '+1' : ''
    const down = l.all ? (Math.min(0, ...votes) < 0 ? fmtVote(Math.min(...votes)) : '') : l.rejected ? '✗' : l.disliked ? '−1' : ''
    return up || down ? [`${abbrev(name)} ${[up, down].filter(Boolean).join('/')}`] : []
  })
}

export const initial = (a?: { name?: string; username?: string }): string => (a?.name ?? a?.username ?? '?').trim().charAt(0).toUpperCase()
export const who = (a?: { name?: string; username?: string; email?: string }): string => a?.name ?? a?.username ?? a?.email ?? 'Unknown'

/** The signed-in account (`me` = account id; the HTTP username need not match the account's) is in the attention set. */
export const needsMe = (ch: GerritChange, me: number | null): boolean => me !== null && Object.values(ch.attention_set ?? {}).some((a) => a.account._account_id === me)

/** Gerrit DiffInfo → unified diff text for react-diff-view's parseDiff (a new hunk after every `skip`). */
export function diffText(d: GerritDiff): string {
  const out = ['diff --git a/f b/f', d.meta_a ? '--- a/f' : '--- /dev/null', d.meta_b ? '+++ b/f' : '+++ /dev/null']
  let a = 1
  let b = 1
  let start = [1, 1]
  let hunk: string[] = []
  let [na, nb] = [0, 0]
  const flush = () => {
    if (hunk.length) out.push(`@@ -${na ? start[0] : start[0] - 1},${na} +${nb ? start[1] : start[1] - 1},${nb} @@`, ...hunk)
    hunk = []
    start = [a, b]
    na = nb = 0
  }
  for (const blk of d.content) {
    if (blk.skip) {
      flush()
      a += blk.skip
      b += blk.skip
      start = [a, b]
    }
    for (const l of blk.ab ?? []) (hunk.push(' ' + l), a++, b++, na++, nb++)
    for (const l of blk.a ?? []) (hunk.push('-' + l), a++, na++)
    for (const l of blk.b ?? []) (hunk.push('+' + l), b++, nb++)
  }
  flush()
  return out.join('\n') + '\n'
}

export const fileLabel = (path: string): string => ({ '/COMMIT_MSG': 'Commit Message', '/MERGE_LIST': 'Merge List' })[path] ?? path

/** Group comments into threads by following `in_reply_to` to the root; oldest first in each thread. */
export function threadsOf<C extends { id: string; in_reply_to?: string; updated: string }>(comments: C[]): C[][] {
  const byId = new Map(comments.map((c) => [c.id, c]))
  const groups = new Map<string, C[]>()
  for (const c of comments) {
    let root = c
    for (let i = 0; root.in_reply_to && byId.has(root.in_reply_to) && i < comments.length; i++) root = byId.get(root.in_reply_to)!
    groups.set(root.id, [...(groups.get(root.id) ?? []), c])
  }
  return [...groups.values()].map((t) => t.sort((x, y) => x.updated.localeCompare(y.updated))).sort((x, y) => x[0].updated.localeCompare(y[0].updated))
}
