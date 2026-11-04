import os from 'node:os'
import path from 'node:path'
import { endOfOptions, git, GitError } from './runner'

/** Top-level work tree containing `dir` (PLAN.md 4.1: a subfolder opens its repo). Throws "Not a git repository". */
export async function repoTopLevel(dir: string, env?: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await git(['rev-parse', '--show-toplevel'], { cwd: dir, env })
    return path.resolve(stdout.trim())
  } catch (err) {
    // Bare repos / .git dirs fail with "must be run in a work tree": not openable either.
    if (err instanceof GitError && (err.kind === 'NotARepository' || /must be run in a work tree/.test(err.stderr)))
      throw new GitError('NotARepository', 'Not a git repository', err.args)
    throw err
  }
}

/** Repo dir git refused as owned by another user (CVE-2022-24765 check), from its error; null for any other error. */
export function dubiousDir(err: unknown): string | null {
  if (!(err instanceof GitError) || err.kind !== 'DubiousOwnership') return null
  const dir = /dubious ownership in repository at '(.+)'/.exec(err.stderr)?.[1]
  return dir && dir !== '*' && path.isAbsolute(dir) ? dir : null
}

/** "Trust this folder": `safe.directory` for exactly `dir` in the user's global config (never `*`). */
export async function trustDirectory(dir: string, env?: NodeJS.ProcessEnv): Promise<void> {
  if (dir === '*' || !path.isAbsolute(dir) || /[\0\n]/.test(dir)) throw new Error('Invalid folder')
  await git(['config', '--global', '--add', ...endOfOptions('safe.directory', dir)], { cwd: os.homedir(), env })
}
