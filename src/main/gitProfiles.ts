// Git config profiles in userData/git-profiles/: index.json lists profiles { id, name } and assignments
// { gitDir, repoId, profileId }; each profile is a real git config file `<id>.gitconfig`, read and written only through
// git/config.ts (allow-listed keys, git does the quoting). File names are built from mendel-generated UUIDs only, never
// from the profile name. Assignments are applied on the global side: assignments.gitconfig (generated) holds the
// includeIf sections, and the global config gets one include.path line pointing at it while any assignment exists.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import { GIT_CONFIG_FIELDS, gitProfileNameSchema, type GitConfigWrite, type GitProfile, type RepoGitConfig } from '../shared/gitConfig'
import { commonGitDir, effectiveConfig, readConfig, setGlobalInclude, writeConfig, writeGitdirIncludes } from './git/config'
import log from './log'

type Entry = Omit<GitProfile, 'values' | 'repos'>
/** `gitDir`: the repository's real common git dir; `repoId`: the repo list entry it was made from (moved-repo fix). */
type Assignment = { gitDir: string; repoId: string; profileId: string }
type Index = { profiles: Entry[]; assignments: Assignment[] }

const MAX_PROFILES = 100

// One change at a time: each reads index.json, awaits git, then saves it; interleaved, one save would drop another's entry.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const r = queue.then(fn)
  queue = r.catch(() => {})
  return r
}

const entry = z.object({ id: z.uuid(), name: gitProfileNameSchema })
const assignment = z.object({
  gitDir: z.string().max(4096).regex(/^\P{Cc}+$/u).refine((p) => path.isAbsolute(p)),
  repoId: z.string().min(1).max(64),
  profileId: z.uuid()
})

export const profilesDir = () => path.join(app.getPath('userData'), 'git-profiles')
const indexFile = (dir: string) => path.join(dir, 'index.json')
export const assignmentsFile = (dir: string) => path.join(dir, 'assignments.gitconfig')
export const profileFile = (dir: string, id: string) => path.join(dir, `${z.uuid().parse(id)}.gitconfig`)

/**
 * Keep each valid entry (first of a duplicate profile id or name, or of an assignment's gitDir, wins); a bad entry never
 * drops the rest. An assignment of a profile that is not listed is dropped.
 */
export function parseIndex(raw: unknown): Index {
  const r = raw as { profiles?: unknown; assignments?: unknown } | null
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
  const profiles: Entry[] = []
  for (const e of list(r?.profiles)) {
    const p = entry.safeParse(e)
    if (p.success && !profiles.some((x) => x.id === p.data.id || same(x.name, p.data.name))) profiles.push({ id: p.data.id, name: p.data.name })
  }
  const assignments: Assignment[] = []
  for (const e of list(r?.assignments)) {
    const a = assignment.safeParse(e)
    if (a.success && profiles.some((p) => p.id === a.data.profileId) && !assignments.some((x) => x.gitDir === a.data.gitDir))
      assignments.push({ gitDir: a.data.gitDir, repoId: a.data.repoId, profileId: a.data.profileId })
  }
  return { profiles, assignments }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function load(dir: string): Index {
  const file = indexFile(dir)
  try {
    return parseIndex(JSON.parse(readFileSync(file, 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { profiles: [], assignments: [] }
    // Moved aside (never over an earlier one); profile files are never removed for this.
    const kept = `${file}.corrupt-${Date.now()}`
    log.warn(`[git-profiles] index unreadable, starting empty (kept as ${path.basename(kept)})`, err)
    renameSync(file, kept)
    return { profiles: [], assignments: [] }
  }
}

function save(dir: string, index: Index): void {
  const tmp = indexFile(dir) + '.tmp'
  writeFileSync(tmp, JSON.stringify(index, null, 2), { mode: 0o600 }) // owner-only (S9)
  renameSync(tmp, indexFile(dir))
}

function checkName(profiles: Entry[], name: string, self?: string): string {
  const n = gitProfileNameSchema.parse(name)
  const dup = profiles.find((p) => p.id !== self && same(p.name, n))
  if (dup) throw new Error(`A profile named "${dup.name}" already exists`)
  return n
}

function find(profiles: Entry[], id: string): Entry {
  const p = profiles.find((x) => x.id === id)
  if (!p) throw new Error('Profile not found')
  return p
}

/**
 * Rebuild assignments.gitconfig, then the global include line, from the index (never patched). Every change saves the
 * index first and calls this after, so a crash in between leaves a stale file or line that the next change rebuilds;
 * meanwhile a missing file behind the line is ignored by git, and the line goes last when it is removed.
 */
async function sync(dir: string, assignments: Assignment[], env?: NodeJS.ProcessEnv): Promise<void> {
  const file = assignmentsFile(dir)
  await writeGitdirIncludes(file, assignments.map((a) => ({ gitDir: a.gitDir, include: profileFile(dir, a.profileId) })), env)
  await setGlobalInclude(file, assignments.length > 0, env)
}

export async function listProfiles(dir: string, env?: NodeJS.ProcessEnv): Promise<GitProfile[]> {
  const { profiles, assignments } = load(dir)
  return Promise.all(
    profiles.map(async (p) => ({
      ...p,
      values: await readConfig({ file: profileFile(dir, p.id) }, dir, env),
      repos: assignments.filter((a) => a.profileId === p.id).length
    }))
  )
}

export const createProfile = (dir: string, name: string, values: GitConfigWrite, env?: NodeJS.ProcessEnv): Promise<Entry> =>
  serial(async () => {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const index = load(dir)
    const { profiles } = index
    if (profiles.length >= MAX_PROFILES) throw new Error(`At most ${MAX_PROFILES} profiles`)
    const p = { id: randomUUID(), name: checkName(profiles, name) }
    const file = profileFile(dir, p.id)
    writeFileSync(file, '', { mode: 0o600, flag: 'wx' }) // a profile with no field set still has its file
    try {
      await writeConfig({ file }, dir, values, env)
    } catch (err) {
      rmSync(file, { force: true })
      throw err
    }
    save(dir, { ...index, profiles: [...profiles, p] })
    return p
  })

/** Rename and set (or, for '', unset) the given fields; absent fields stay as they are. */
export const updateProfile = (dir: string, id: string, name: string, values: GitConfigWrite, env?: NodeJS.ProcessEnv): Promise<void> =>
  serial(async () => {
    const index = load(dir)
    const p = find(index.profiles, id)
    const n = checkName(index.profiles, name, id)
    await writeConfig({ file: profileFile(dir, id) }, dir, values, env)
    p.name = n
    save(dir, index)
  })

/** A profile's name and how many repositories it is assigned to (the delete confirm). */
export function profileUsage(dir: string, id: string): { name: string; repos: number } {
  const { profiles, assignments } = load(dir)
  return { name: find(profiles, id).name, repos: assignments.filter((a) => a.profileId === id).length }
}

/**
 * Index entry (and its assignments) first, then the assignments file and global line, then the profile file: a crash
 * in between leaves an unlisted file, never a listed profile without one.
 */
export const deleteProfile = (dir: string, id: string, env?: NodeJS.ProcessEnv): Promise<void> =>
  serial(async () => {
    const index = load(dir)
    find(index.profiles, id)
    const next = { profiles: index.profiles.filter((p) => p.id !== id), assignments: index.assignments.filter((a) => a.profileId !== id) }
    save(dir, next)
    await sync(dir, next.assignments, env)
    rmSync(profileFile(dir, id), { force: true })
  })

/** Assign a profile (null: unassign) to the repository at `cwd` (repo id `repoId`); its worktrees share it. */
export const assignProfile = (dir: string, repoId: string, cwd: string, profileId: string | null, env?: NodeJS.ProcessEnv): Promise<void> =>
  serial(async () => {
    const gitDir = await commonGitDir(cwd, env)
    // The index refuses it on load (and git a newline in a key): refuse it before anything is written.
    if (profileId && !assignment.shape.gitDir.safeParse(gitDir).success) throw new Error('A profile cannot be assigned to a repository whose path contains control characters')
    const index = load(dir)
    if (profileId) find(index.profiles, profileId)
    index.assignments = index.assignments.filter((a) => a.gitDir !== gitDir && a.repoId !== repoId)
    if (profileId) index.assignments.push({ gitDir, repoId, profileId })
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    save(dir, index)
    await sync(dir, index.assignments, env)
  })

/** The assignment of git dir `gitDir`; with none, one of `repoId` under another git dir (the repository moved) is re-pointed to it. */
async function follow(dir: string, index: Index, repoId: string, gitDir: string, env?: NodeJS.ProcessEnv): Promise<Assignment | undefined> {
  let a = index.assignments.find((x) => x.gitDir === gitDir)
  if (!a && (a = index.assignments.find((x) => x.repoId === repoId))) {
    a.gitDir = gitDir
    save(dir, index)
    await sync(dir, index.assignments, env)
  }
  return a
}

/**
 * Opening repository `repoId` at `cwd`: a moved repository takes its assignment along, so commits use its profile
 * again. Never throws (logged); no git runs unless an assignment of `repoId` exists.
 */
export async function followMovedRepo(dir: string, repoId: string, cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
  try {
    if (!load(dir).assignments.some((a) => a.repoId === repoId)) return
    await serial(async () => void (await follow(dir, load(dir), repoId, await commonGitDir(cwd, env), env)))
  } catch (err) {
    log.warn('[git-profiles] moved repository not followed', err)
  }
}

/**
 * The assigned profile and each field's effective value in the repository at `cwd`. A repository that moved (an
 * assignment of `repoId` under another git dir, none under this one) takes its assignment along; a git dir that no
 * longer exists is never a reason to drop one (unmounted drives).
 */
export const repoGitConfig = (dir: string, repoId: string, cwd: string, env?: NodeJS.ProcessEnv): Promise<RepoGitConfig> =>
  serial(async () => {
    const gitDir = await commonGitDir(cwd, env)
    const index = load(dir)
    const a = await follow(dir, index, repoId, gitDir, env)
    const p = a && find(index.profiles, a.profileId)
    const file = p && profileFile(dir, p.id)
    // Only the assigned profile's file counts as `profile`; any other include of a profile file reads as global.
    const [eff, own] = await Promise.all([effectiveConfig(cwd, file ? [file] : [], env), file ? readConfig({ file }, dir, env) : null])
    const fields = Object.fromEntries(
      GIT_CONFIG_FIELDS.map((f) => [f, { value: eff[f].value, source: eff[f].source, project: eff[f].project, inProfile: own?.[f] != null }])
    ) as RepoGitConfig['fields']
    return {
      profile: p ? { id: p.id, name: p.name } : null,
      fields,
      // git read the profile's value, yet a global definition after it wins.
      trap: GIT_CONFIG_FIELDS.filter((f) => own?.[f] != null && eff[f].profile && eff[f].source === 'global'),
      // The profile sets values, yet git read none of them here (e.g. the global include line was removed by hand).
      notApplied: GIT_CONFIG_FIELDS.some((f) => own?.[f] != null) && !GIT_CONFIG_FIELDS.some((f) => eff[f].profile)
    }
  })
