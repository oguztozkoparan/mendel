import type { GerritLabel } from '../../../../shared/gerrit'

/** Gerrit timestamps are UTC "2026-11-03 10:00:00.000000000". */
export const gerritDate = (s: string): Date => new Date(s.replace(' ', 'T').slice(0, 23) + 'Z')
export const shortDate = (s: string): string => gerritDate(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })

/** "+2", "−1", "0" (typographic minus). */
export const fmtVote = (v: number): string => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0')
/** "Code-Review" → "CR". */
export const abbrev = (label: string): string => label.split(/[-_ ]/).map((w) => w[0] ?? '').join('').toUpperCase()

/** Per label: highest and lowest non-zero vote, e.g. "CR +2/−1", "V +1". */
export function labelSummary(labels: Record<string, GerritLabel> | undefined): string[] {
  return Object.entries(labels ?? {}).flatMap(([name, l]) => {
    const votes = (l.all ?? []).map((v) => v.value ?? 0).filter((v) => v !== 0)
    if (!votes.length) return []
    const max = Math.max(...votes)
    const min = Math.min(...votes)
    return [`${abbrev(name)} ${[max > 0 ? fmtVote(max) : '', min < 0 ? fmtVote(min) : ''].filter(Boolean).join('/')}`]
  })
}

export const initial = (a?: { name?: string; username?: string }): string => (a?.name ?? a?.username ?? '?').trim().charAt(0).toUpperCase()
export const who = (a?: { name?: string; username?: string; email?: string }): string => a?.name ?? a?.username ?? a?.email ?? 'Unknown'
