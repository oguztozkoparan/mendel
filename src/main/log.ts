import log from 'electron-log/main'
import { redactDeep } from './redact'

// Every log line passes through redaction (TECH.md §6.5).
log.hooks.push((msg) => ({
  ...msg,
  data: msg.data.map((d: unknown) => redactDeep(d))
}))

export default log
