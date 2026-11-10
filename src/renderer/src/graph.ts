/**
 * One history row of the commit graph. Columns are lane indices.
 * `col`: the commit's dot; `into`: lanes whose line runs from the row top into the dot;
 * `out`: lanes the dot feeds to the row bottom (first parent at `col`, then merge parents);
 * `pass`: lanes that run straight through the row.
 */
export interface GraphRow {
  col: number
  merge: boolean
  into: number[]
  out: number[]
  pass: number[]
}

/** Between rows: the commit sha each lane waits for (null = free column), and the shas already laid out. */
export interface GraphState {
  lanes: (string | null)[]
  seen: Set<string>
}

/**
 * Lay out `commits` (newest first) starting from `prev` (the state after the previous page).
 * Forward-only: appending a page never changes earlier rows, so pages can be laid out one after another.
 */
export function graphRows(commits: readonly { sha: string; parents: string[] }[], prev?: GraphState): { rows: GraphRow[]; state: GraphState } {
  const rows: GraphRow[] = []
  const seen = new Set(prev?.seen)
  let cur = prev?.lanes ?? []
  for (const c of commits) {
    seen.add(c.sha)
    const into = cur.flatMap((x, i) => (x === c.sha ? [i] : []))
    const next = cur.map((x) => (x === c.sha ? null : x))
    const free = () => {
      const i = next.indexOf(null)
      return i < 0 ? next.push(null) - 1 : i
    }
    // A commit no lane waits for (a branch tip) takes the leftmost free column.
    const col = into[0] ?? free()
    const pass = next.flatMap((x, i) => (x !== null && i !== col ? [i] : []))
    const out: number[] = []
    c.parents.forEach((p, k) => {
      // git's default (date) order can list a parent before its last child (same-second or skewed dates): no lane would ever end there.
      if (seen.has(p)) return
      let j = col
      if (k > 0) {
        j = next.indexOf(p)
        if (j < 0) j = free()
      }
      next[j] = p
      if (!out.includes(j)) out.push(j)
    })
    while (next.length && next[next.length - 1] === null) next.pop()
    rows.push({ col, merge: c.parents.length > 1, into, out, pass })
    cur = next
  }
  return { rows, state: { lanes: cur, seen } }
}

/**
 * `row` drawn in `max` columns: lanes from the last column on share it. `bundle` = this row has a lane past the last
 * column, so the last column stands for several lanes (drawn dashed) instead of silently dropping them.
 */
export function fitRow(row: GraphRow, max: number): GraphRow & { bundle: boolean } {
  const bundle = Math.max(row.col, ...row.into, ...row.out, ...row.pass) >= max
  if (!bundle) return { ...row, bundle }
  const f = (i: number) => Math.min(i, max - 1)
  const fit = (a: number[]) => [...new Set(a.map(f))]
  return { col: f(row.col), merge: row.merge, into: fit(row.into), out: fit(row.out), pass: fit(row.pass), bundle }
}
