import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isolatedGitEnv } from './git-env'

export interface RepoFixture {
  /** Temp root holding home/, remote.git and work/. */
  dir: string
  /** Isolated env; pass it to anything that runs git (our runner, the app under e2e). */
  env: NodeJS.ProcessEnv
  /** Bare repo acting as `origin`. */
  remote: string
  /** Clone of `remote` on `main`, one initial commit pushed. */
  work: string
  /** Run system git (test-side, not our runner) and return trimmed stdout. */
  git(args: string[], cwd?: string): string
  /** Write `name` in work/, stage and commit it; returns the new HEAD sha. */
  commitFile(name: string, content: string, message?: string): string
  cleanup(): void
}

export function createRepoFixture(): RepoFixture {
  // .native: on Windows, expands 8.3 short names (RUNNER~1) the way git reports paths.
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mendel-repo-')))
  const env = isolatedGitEnv(dir)
  const remote = path.join(dir, 'remote.git')
  const work = path.join(dir, 'work')
  const git = (args: string[], cwd = work) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim()
  const commitFile = (name: string, content: string, message = `add ${name}`) => {
    const file = path.join(work, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
    git(['add', '--', name])
    git(['commit', '-q', '-m', message])
    return git(['rev-parse', 'HEAD'])
  }

  git(['init', '-q', '--bare', remote], dir)
  git(['clone', '-q', remote, work], dir)
  commitFile('README.md', '# fixture\n', 'initial commit')
  git(['push', '-q', 'origin', 'main'])

  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
    } catch (err) {
      // shortcut: on Windows a killed git's sh/sleep grandchild can still hold the dir; leave it in %TEMP%.
      if (process.platform !== 'win32') throw err
    }
  }
  return { dir, env, remote, work, git, commitFile, cleanup }
}
