// Identity/signing config per scope (global, a repo's own config, a config file) and the effective value of a repo
// with its source. Only the allow-listed keys of shared/gitConfig.ts can be read or written here.
import path from 'node:path'
import {
  GIT_CONFIG_FIELDS,
  GIT_CONFIG_KEYS,
  gitConfigWriteSchema,
  type GitConfigEffective,
  type GitConfigField,
  type GitConfigSource,
  type GitConfigValues,
  type GitConfigWrite
} from '../../shared/gitConfig'
import { endOfOptions, git } from './runner'

/** `local` = the repository at `cwd` (its common .git/config); `file` = any config file (profile files). */
export type ConfigScope = 'global' | 'local' | { file: string }

const scopeArgs = (s: ConfigScope) => (s === 'global' ? ['--global'] : s === 'local' ? ['--local'] : ['--file', s.file])
// git prints canonical (lowercased) key names, so this matches exactly the allow-list.
const KEYS_RE = '^(user\\.(name|email|signingkey)|commit\\.gpgsign|gpg\\.format)$'
const FIELD_OF = Object.fromEntries(GIT_CONFIG_FIELDS.map((f) => [GIT_CONFIG_KEYS[f], f])) as Record<string, GitConfigField>
const byField = <T>(v: () => T) => Object.fromEntries(GIT_CONFIG_FIELDS.map((f) => [f, v()])) as Record<GitConfigField, T>

/** git's bool parsing (valueless key = true), so `yes`/`on`/`1` show as 'true'; anything else stays as written. */
function boolValue(v: string | null): string {
  if (v === null) return 'true'
  const l = v.trim().toLowerCase()
  if (['true', 'yes', 'on'].includes(l)) return 'true'
  if (['false', 'no', 'off', ''].includes(l)) return 'false'
  const n = /^-?(\d+)[kmg]?$/.exec(l) // git ints take a k/m/g unit suffix
  return n ? (Number(n[1]) ? 'true' : 'false') : v
}

/** A `-z` "key\nvalue" record -> [field, value]; undefined for keys outside the allow-list. */
function entry(rec: string): [GitConfigField, string | null] | undefined {
  const nl = rec.indexOf('\n')
  const field = FIELD_OF[nl < 0 ? rec : rec.slice(0, nl)]
  if (!field) return undefined
  const raw = nl < 0 ? null : rec.slice(nl + 1)
  return [field, field === 'gpgSign' ? boolValue(raw) : raw || null]
}

/** The allow-listed values set in one scope (includes not followed); the last definition of a key wins. */
export async function readConfig(scope: ConfigScope, cwd: string, env?: NodeJS.ProcessEnv): Promise<GitConfigValues> {
  // Exit 1: no key matched (also a missing file).
  const r = await git(['config', ...scopeArgs(scope), '-z', '--get-regexp', ...endOfOptions(KEYS_RE)], { cwd, env, background: true, okExitCodes: [1] })
  const out = byField<string | null>(() => null)
  for (const rec of r.stdout.split('\0')) {
    const e = entry(rec)
    if (e) out[e[0]] = e[1]
  }
  return out
}

/**
 * Set (or, for '', unset) the given fields in one scope. Everything is validated and every argv built before the
 * first write, so an invalid field writes nothing; a git failure midway can still leave earlier fields written.
 */
export async function writeConfig(scope: ConfigScope, cwd: string, values: GitConfigWrite, env?: NodeJS.ProcessEnv): Promise<void> {
  const parsed = gitConfigWriteSchema.parse(values)
  const runs = GIT_CONFIG_FIELDS.filter((f) => parsed[f] !== undefined).map((f) => {
    const v = parsed[f] as string
    const key = GIT_CONFIG_KEYS[f]
    return v === ''
      ? { args: ['config', ...scopeArgs(scope), '--unset-all', ...endOfOptions(key)], okExitCodes: [5] } // 5: key not set
      : { args: ['config', ...scopeArgs(scope), '--replace-all', ...endOfOptions(key, v)], okExitCodes: [] }
  })
  for (const r of runs) await git(r.args, { cwd, env, okExitCodes: r.okExitCodes })
}

const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)

function sourceOf(scope: string, file: string | null, profileFiles: string[]): GitConfigSource {
  if (scope === 'local' || scope === 'worktree') return 'project'
  if (scope === 'global') return file && profileFiles.some((p) => samePath(p, file)) ? 'profile' : 'global'
  return scope === 'system' ? 'system' : 'command'
}

/**
 * Effective value of each allow-listed key in the repo at `cwd` and where it comes from (git's last definition wins).
 * `profileFiles`: the profile config files the caller knows; a global-scope value from one of them is `profile`.
 * Pass absolute paths spelled as in the include.path that points at them: git prints the include path (resolved
 * against the including file, `~` expanded) without resolving symlinks, and only drive/case differences are folded
 * on win32.
 */
export async function effectiveConfig(cwd: string, profileFiles: string[], env?: NodeJS.ProcessEnv): Promise<Record<GitConfigField, GitConfigEffective>> {
  const r = await git(['config', '--show-origin', '--show-scope', '-z', '--get-regexp', ...endOfOptions(KEYS_RE)], { cwd, env, background: true, okExitCodes: [1] })
  const out = byField<GitConfigEffective>(() => ({ value: null, source: 'none', project: null, profile: null }))
  // -z records: scope, origin ("file:<path>", "command line:", …), "key\nvalue".
  const parts = r.stdout.split('\0')
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const e = entry(parts[i + 2])
    if (!e) continue
    const [field, value] = e
    const file = parts[i + 1].startsWith('file:') ? parts[i + 1].slice(5) : null
    const source = sourceOf(parts[i], file, profileFiles)
    const o = out[field]
    o.value = value
    o.source = source
    if (source === 'project') o.project = value
    if (source === 'profile' && file && value !== null) o.profile = { file, value }
  }
  return out
}
