import log from 'electron-log/main'
import { redact } from './redact'

// Every log line passes through redaction (TECH.md §6.5).
log.hooks.push((msg) => ({
  ...msg,
  data: msg.data.map((d: unknown) =>
    typeof d === 'string' ? redact(d) : d instanceof Error ? redact(d.stack ?? d.message) : d
  )
}))

export default log
