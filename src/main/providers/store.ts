// Provider state in userData/providers.json: per-host detection cache and per-repo overrides (PLAN.md §4.3).
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import log from '../log'

const schema = z.object({
  /** Remote host → probed Gerrit base URL + version. */
  hosts: z.record(z.string(), z.object({ baseUrl: z.string(), version: z.string().optional() })).default({}),
  /** repoId → override. */
  repos: z
    .record(z.string(), z.object({ provider: z.enum(['auto', 'gerrit', 'none']), baseUrl: z.string().optional(), version: z.string().optional() }))
    .default({}),
  /** Gerrit host (with port) → username + safeStorage-encrypted secret (base64). */
  credentials: z.record(z.string(), z.object({ username: z.string(), secret: z.string() })).default({}),
  /** Gerrit host → incoming change numbers at the last review-notification poll. */
  seenIncoming: z.record(z.string(), z.array(z.number())).default({})
})
export type ProviderStore = z.infer<typeof schema>

let store: ProviderStore | undefined
const file = () => path.join(app.getPath('userData'), 'providers.json')

export function providerStore(): ProviderStore {
  if (store) return store
  try {
    store = schema.parse(JSON.parse(readFileSync(file(), 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('[providers] unreadable, starting empty', err)
    store = schema.parse({})
  }
  return store
}

export function saveProviderStore(): void {
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(providerStore(), null, 2), { mode: 0o600 }) // owner-only (S9)
  renameSync(tmp, file())
}
