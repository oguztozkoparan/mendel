// Git config profiles in userData/git-profiles/: index.json lists { id, name }; each profile is a real git config file
// `<id>.gitconfig`, read and written only through git/config.ts (allow-listed keys, git does the quoting). File names
// are built from mendel-generated UUIDs only, never from the profile name.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import { gitProfileNameSchema, type GitConfigWrite, type GitProfile } from '../shared/gitConfig'
import { readConfig, writeConfig } from './git/config'
import log from './log'

type Entry = Omit<GitProfile, 'values'>

const MAX_PROFILES = 100

// One change at a time: each reads index.json, awaits git, then saves it; interleaved, one save would drop another's entry.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const r = queue.then(fn)
  queue = r.catch(() => {})
  return r
}

const entry = z.object({ id: z.uuid(), name: gitProfileNameSchema })

export const profilesDir = () => path.join(app.getPath('userData'), 'git-profiles')
const indexFile = (dir: string) => path.join(dir, 'index.json')
export const profileFile = (dir: string, id: string) => path.join(dir, `${z.uuid().parse(id)}.gitconfig`)

/** Keep each valid entry (first of a duplicate id or name wins); a bad entry never drops the rest. */
export function parseIndex(raw: unknown): Entry[] {
  const list = (raw as { profiles?: unknown } | null)?.profiles
  const out: Entry[] = []
  for (const e of Array.isArray(list) ? list : []) {
    const r = entry.safeParse(e)
    if (r.success && !out.some((p) => p.id === r.data.id || same(p.name, r.data.name))) out.push({ id: r.data.id, name: r.data.name })
  }
  return out
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function load(dir: string): Entry[] {
  const file = indexFile(dir)
  try {
    return parseIndex(JSON.parse(readFileSync(file, 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    // Moved aside (never over an earlier one); profile files are never removed for this.
    const kept = `${file}.corrupt-${Date.now()}`
    log.warn(`[git-profiles] index unreadable, starting empty (kept as ${path.basename(kept)})`, err)
    renameSync(file, kept)
    return []
  }
}

function save(dir: string, profiles: Entry[]): void {
  const tmp = indexFile(dir) + '.tmp'
  writeFileSync(tmp, JSON.stringify({ profiles }, null, 2), { mode: 0o600 }) // owner-only (S9)
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

export async function listProfiles(dir: string, env?: NodeJS.ProcessEnv): Promise<GitProfile[]> {
  return Promise.all(load(dir).map(async (p) => ({ ...p, values: await readConfig({ file: profileFile(dir, p.id) }, dir, env) })))
}

export const createProfile = (dir: string, name: string, values: GitConfigWrite, env?: NodeJS.ProcessEnv): Promise<Entry> =>
  serial(async () => {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const profiles = load(dir)
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
    save(dir, [...profiles, p])
    return p
  })

/** Rename and set (or, for '', unset) the given fields; absent fields stay as they are. */
export const updateProfile = (dir: string, id: string, name: string, values: GitConfigWrite, env?: NodeJS.ProcessEnv): Promise<void> =>
  serial(async () => {
    const profiles = load(dir)
    const p = find(profiles, id)
    const n = checkName(profiles, name, id)
    await writeConfig({ file: profileFile(dir, id) }, dir, values, env)
    p.name = n
    save(dir, profiles)
  })

export const profileName = (dir: string, id: string) => find(load(dir), id).name

/** Index entry first, then the file: a crash in between leaves an unlisted file, never a listed profile without one. */
export const deleteProfile = (dir: string, id: string): Promise<void> =>
  serial(async () => {
    const profiles = load(dir)
    find(profiles, id)
    save(dir, profiles.filter((p) => p.id !== id))
    rmSync(profileFile(dir, id), { force: true })
  })
