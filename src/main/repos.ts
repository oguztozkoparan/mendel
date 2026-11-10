// Recent repos list (userData/repos.json). The renderer addresses repos by id only (TECH.md §6.2).
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import type { RepoEntry } from '../shared/ipc'
import { samePath } from './git/worktree'
import log from './log'

const schema = z.object({
  repos: z.array(z.object({ id: z.string(), path: z.string() })),
  current: z.string().nullable(),
  cloneParent: z.string().optional()
})
type Store = z.infer<typeof schema>

let store: Store | undefined
const file = () => path.join(app.getPath('userData'), 'repos.json')

function load(): Store {
  if (store) return store
  try {
    store = schema.parse(JSON.parse(readFileSync(file(), 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('[repos] unreadable, starting empty', err)
    store = { repos: [], current: null }
  }
  return store
}

function save(): void {
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(load(), null, 2), { mode: 0o600 }) // owner-only (S9)
  renameSync(tmp, file())
}

/**
 * Linked worktree at `root`: its `.git` file points into `<main>/.git/worktrees/<name>` (bare main: `<main>/worktrees/<name>`).
 * Plain fs reads (labels only, no git per list); undefined for a normal repo or anything unreadable.
 */
export function linkedWorktree(root: string): RepoEntry['worktree'] {
  try {
    const dotGit = path.join(root, '.git')
    if (!statSync(dotGit).isFile()) return undefined
    const m = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, 'utf8'))
    if (!m) return undefined
    const gitdir = path.resolve(root, m[1]!.trim()) // relative with worktree.useRelativePaths
    if (path.basename(path.dirname(gitdir)) !== 'worktrees') return undefined // e.g. a submodule
    const common = path.dirname(path.dirname(gitdir))
    const head = readFileSync(path.join(gitdir, 'HEAD'), 'utf8')
    return { main: path.basename(common) === '.git' ? path.dirname(common) : common, branch: /^ref: refs\/heads\/(.+)$/m.exec(head)?.[1]?.trim() ?? null }
  } catch {
    return undefined
  }
}

const entry = (r: { id: string; path: string }): RepoEntry => {
  const worktree = linkedWorktree(r.path)
  return { ...r, name: path.basename(worktree?.main ?? r.path), exists: existsSync(r.path), ...(worktree ? { worktree } : {}) }
}

/** Most recent first, but linked worktrees right after their main repo's entry when that is listed. */
export function listRepos(): { repos: RepoEntry[]; current: string | null } {
  const s = load()
  const all = s.repos.map(entry)
  const isMain = (w: RepoEntry, r: RepoEntry) => !r.worktree && !!w.worktree && samePath(w.worktree.main, r.path)
  const repos = all.flatMap((r) => (r.worktree && all.some((m) => isMain(r, m)) ? [] : [r, ...all.filter((w) => isMain(w, r))]))
  return { repos, current: repos.find((r) => r.id === s.current && r.exists)?.id ?? null }
}

/** Absolute root of a known repo; throws for ids the user never added. */
export function repoRoot(id: string): string {
  const r = load().repos.find((x) => x.id === id)
  if (!r) throw new Error('Unknown repository')
  return r.path
}

/** Add (or re-point `locate`) and mark as current, most recent first. */
export function rememberRepo(root: string, locate?: string): RepoEntry {
  const s = load()
  const existing = s.repos.find((r) => r.id === locate) ?? s.repos.find((r) => r.path === root)
  const r = { id: existing?.id ?? randomUUID(), path: root }
  s.repos = [r, ...s.repos.filter((x) => x.id !== r.id && x.path !== root)]
  s.current = r.id
  save()
  return entry(r)
}

/** Drop the entry of folder `root` (a removed worktree), if listed. */
export function forgetPath(root: string): void {
  const r = load().repos.find((x) => samePath(x.path, root))
  if (r) forgetRepo(r.id)
}

export function forgetRepo(id: string): void {
  const s = load()
  s.repos = s.repos.filter((r) => r.id !== id)
  if (s.current === id) s.current = null
  save()
}

/** Where clones go: last folder picked in the clone dialog, else Documents. */
export function cloneParent(set?: string): string {
  const s = load()
  if (set) {
    s.cloneParent = set
    save()
  }
  if (s.cloneParent) return s.cloneParent
  // Windows throws when the Documents known folder can't be resolved (redirected or missing profile).
  try {
    return app.getPath('documents')
  } catch {
    return app.getPath('home')
  }
}

/** "Reopen last repo on start" off: start on the welcome screen. */
export function clearCurrent(): void {
  const s = load()
  if (s.current === null) return
  s.current = null
  save()
}
