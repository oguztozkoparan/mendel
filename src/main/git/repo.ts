import path from 'node:path'
import { git, GitError } from './runner'

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
