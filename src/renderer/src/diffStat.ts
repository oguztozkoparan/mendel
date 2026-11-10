/** +added / −removed line counts of raw diff texts (lines after the first hunk header); null for a binary diff. */
export const diffStat = (raws: string[]) => {
  let a = 0
  let d = 0
  for (const raw of raws) {
    if (/^(Binary files |GIT binary patch)/m.test(raw)) return null
    const start = raw.search(/^@@/m)
    if (start < 0) continue
    for (const l of raw.slice(start).split('\n')) {
      if (l[0] === '+') a++
      else if (l[0] === '-') d++
    }
  }
  return { a, d }
}
