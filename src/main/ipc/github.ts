import { net, shell } from 'electron'
import { DEVICE_PAGE, githubAuth, githubSession, GITHUB_ORIGINS, type DeviceCode } from '../providers/github/client'
import { credentialUser, getCredential, removeCredential, saveCredential } from '../providers/credentials'
import type { Fetch } from '../providers/http'
import { testSeams } from '../security'
import { urlAllowed } from '../update/feed'
import type { Handlers } from '.'

// net.fetch: Chromium network stack (OS cert store, system proxy); TLS errors are never overridden (TECH.md §6.6).
const fetchFn: Fetch = (url, init) => net.fetch(url, init)

// S13: e2e builds only, one loopback mock stands in for both github.com and api.github.com.
const mock = testSeams ? process.env.MENDEL_E2E_GITHUB : undefined
const origins = mock && urlAllowed(mock, true) ? { login: new URL(mock).origin, api: new URL(mock).origin } : GITHUB_ORIGINS
const auth = githubAuth(fetchFn, origins)

/** Signed-in GitHub account (per API host, not per repo); `api` is the authenticated GET for provider features. */
export const github = githubSession(fetchFn, { get: getCredential, save: saveCredential, remove: removeCredential }, origins)

/** The one sign-in in flight: its device code (never sent to the renderer) and polling. */
let pending: { ac: AbortController; dc: DeviceCode; result?: Promise<{ login: string; persisted: boolean }> } | null = null
/** Bumped by every cancel: a sign-in whose device-code request outlived a cancel or a newer sign-in is dropped. */
let generation = 0
/** Stops the sign-in in flight (Cancel, a new sign-in, quitting). */
export const cancelGithubSignIn = () => {
  generation++
  pending?.ac.abort()
  pending = null
}

export const githubHandlers: Handlers<'github:signIn' | 'github:wait' | 'github:cancel' | 'github:openDevicePage' | 'github:signOut' | 'github:account'> = {
  'github:signIn': async () => {
    cancelGithubSignIn()
    const g = generation
    const p = { ac: new AbortController(), dc: await auth.requestDeviceCode() }
    if (g !== generation) throw new Error('Sign-in cancelled')
    pending = p
    return { userCode: p.dc.userCode, expiresAt: p.dc.expiresAt }
  },
  'github:wait': () => {
    const p = pending
    if (!p) throw new Error('No GitHub sign-in in progress')
    p.result ??= auth
      .pollToken(p.dc, p.ac.signal)
      .then((token) => github.save(token))
      .finally(() => pending === p && (pending = null))
    return p.result
  },
  'github:cancel': cancelGithubSignIn,
  'github:openDevicePage': () => shell.openExternal(DEVICE_PAGE),
  // Local only: revoking a user token server-side needs the app's client secret, which this app does not have.
  'github:signOut': () => removeCredential(github.host),
  'github:account': () => credentialUser(github.host)
}
