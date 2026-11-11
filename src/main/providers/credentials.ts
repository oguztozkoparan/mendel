// Provider HTTP password / token per host (TECH.md §6.5): encrypted with safeStorage's async API into
// providers.json; never sent to the renderer, logged, or put in argv/env.
import { safeStorage } from 'electron'
import { providerStore, saveProviderStore } from './store'

export interface Credential {
  username: string
  /** Gerrit: HTTP password or access token, sent as Basic auth. GitHub: the token set as JSON, sent as Bearer. */
  password: string
}

/** Decrypted (or session-only) secrets for this run. */
const session = new Map<string, Credential>()

async function canPersist(): Promise<boolean> {
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false
  return safeStorage.isAsyncEncryptionAvailable()
}

/** Store for `host`; returns false when only kept for this session (no usable OS keychain). */
export async function saveCredential(host: string, auth: Credential): Promise<boolean> {
  session.set(host, auth)
  const s = providerStore()
  delete s.credentials[host]
  const persist = await canPersist()
  if (persist) s.credentials[host] = { username: auth.username, secret: (await safeStorage.encryptStringAsync(auth.password)).toString('base64') }
  saveProviderStore()
  return persist
}

export async function getCredential(host: string): Promise<Credential | null> {
  const cached = session.get(host)
  if (cached) return cached
  const c = providerStore().credentials[host]
  if (!c) return null
  const { result } = await safeStorage.decryptStringAsync(Buffer.from(c.secret, 'base64'))
  const auth = { username: c.username, password: result }
  session.set(host, auth)
  return auth
}

/** Username stored for `host` (shown in the UI), without touching the secret. */
export function credentialUser(host: string): string | null {
  return session.get(host)?.username ?? providerStore().credentials[host]?.username ?? null
}

export function removeCredential(host: string): void {
  session.delete(host)
  delete providerStore().credentials[host]
  saveProviderStore()
}
