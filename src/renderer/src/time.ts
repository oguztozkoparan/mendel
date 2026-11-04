const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536e6], ['month', 2592e6], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]]

/** "5 minutes ago" for an ms epoch; under a minute is "just now". */
export function ago(ms: number, now = Date.now()): string {
  const d = ms - now
  for (const [unit, size] of STEPS) if (Math.abs(d) >= size) return rtf.format(Math.round(d / size), unit)
  return 'just now'
}
