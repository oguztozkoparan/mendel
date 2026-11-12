import { net, shell } from 'electron'
import { DEVICE_PAGE, INSTALL_PAGE, githubAuth, githubSession, GITHUB_ORIGINS, type DeviceCode } from '../providers/github/client'
import { githubLink, onGithub } from '../../shared/github'
import { credentialUser, getCredential, removeCredential, saveCredential } from '../providers/credentials'
import log from '../log'
import type { Fetch } from '../providers/http'
import { testSeams } from '../security'
import { checkoutRef, listBranches, validateBranchName } from '../git/branch'
import { repoRoot } from '../repos'
import { confirm } from './branch'
import { activeState } from './provider'
import { exclusive } from './sync'
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

/** The repo's own GitHub detection: 'owner/repo' and remote name (never taken from the renderer). */
async function detectionOf(repo: string) {
  const d = (await activeState(repo)).detection
  if (d?.provider !== 'github') throw new Error('GitHub is not active for this repository')
  return d
}
const projectOf = async (repo: string) => (await detectionOf(repo)).project

/** Opens `https://github.com/<owner>/<repo>/<rest>`; the project comes from detection, each part encoded. */
async function openRepoPage(repo: string, rest: string) {
  const u = new URL(`${(await projectOf(repo)).split('/').map(encodeURIComponent).join('/')}/${rest}`, 'https://github.com/')
  if (u.origin !== 'https://github.com') return log.warn('[github] blocked external url')
  await shell.openExternal(u.href)
}

export const githubHandlers: Handlers<
  'github:signIn' | 'github:wait' | 'github:cancel' | 'github:openDevicePage' | 'github:openInstallPage' | 'github:signOut' | 'github:account' | 'github:pulls' | 'github:openPull' | 'github:openPulls' | 'github:openLink' | 'github:checkout' | 'github:createPull'
> = {
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
  'github:openInstallPage': () => shell.openExternal(INSTALL_PAGE),
  // Local only: revoking a user token server-side needs the app's client secret, which this app does not have.
  'github:signOut': () => removeCredential(github.host),
  'github:account': () => credentialUser(github.host),
  'github:pulls': async ({ repo }) => github.pulls(await projectOf(repo)),
  'github:openPull': ({ repo, number }) => openRepoPage(repo, `pull/${number}`),
  'github:openPulls': ({ repo }) => openRepoPage(repo, 'pulls'),
  'github:openLink': async ({ repo, href }) => {
    const u = githubLink(await projectOf(repo), href)
    if (!u || !onGithub(u)) return log.warn('[github] blocked external url')
    await shell.openExternal(u.href)
  },
  'github:createPull': async ({ repo }) => {
    const { remote } = await detectionOf(repo)
    const { current, local } = await listBranches(repoRoot(repo))
    if (!current) throw new Error('Switch to a branch first')
    // Upstream from local git ("origin/feat/x"); GitHub picks the base branch itself.
    const upstream = local.find((b) => b.name === current)?.upstream
    if (!upstream?.startsWith(`${remote}/`)) throw new Error('Push the branch first')
    await openRepoPage(repo, `compare/${encodeURIComponent(upstream.slice(remote.length + 1))}?expand=1`)
  },
  'github:checkout': async ({ repo, number }, e) => {
    const { project, remote } = await detectionOf(repo)
    const root = repoRoot(repo)
    // The head branch comes from GitHub's answer for this number, never from the renderer; names are case-insensitive.
    const pr = await github.pull(project, number)
    if (pr.head.repo?.full_name.toLowerCase() !== project.toLowerCase()) throw new Error('Fork pull requests cannot be checked out yet')
    const ref = await validateBranchName(root, pr.head.ref)
    const name = `pr/${number}`
    const ask = (q: 'replace' | 'stash') =>
      q === 'replace'
        ? confirm(e, 'Reset', `Reset ${name} to the pull request head?`, `Commits that are only on ${name} are lost.`)
        : confirm(e, 'Stash & switch', 'Your local changes would be overwritten by the checkout.', 'Stash them now and restore them when you come back to this branch.')
    return exclusive((signal) => checkoutRef(root, remote, `refs/heads/${ref}`, name, `${remote}/${ref}`, ask, undefined, signal))
  }
}
