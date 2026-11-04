// The only place that starts git (TECH.md §6.3): absolute git path, argv arrays, no shell.
import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import path from 'node:path'
import { redact } from '../redact'

export const MIN_GIT_VERSION = '2.30.0'
/** Older versions miss security fixes (CVE-2024-32002, CVE-2025-48384): warn, don't block. */
export const RECOMMENDED_GIT_VERSION = '2.50.1'
const MAX_OUTPUT = 64 * 1024 * 1024

export type GitErrorKind =
  | 'GitNotFound'
  | 'NotARepository'
  | 'DubiousOwnership'
  | 'AuthFailed'
  | 'HostKeyVerificationFailed'
  | 'RemoteUnreachable'
  | 'PushRejected'
  | 'MergeConflict'
  | 'IndexLocked'
  | 'Cancelled'
  | 'Timeout'
  | 'OutputTooLarge'
  | 'Unknown'

// First match wins; order matters (auth failures also print "Could not read from remote repository").
const ERROR_PATTERNS: [GitErrorKind, RegExp][] = [
  ['NotARepository', /not a git repository/i],
  ['DubiousOwnership', /detected dubious ownership/i],
  ['HostKeyVerificationFailed', /Host key verification failed/i],
  ['AuthFailed', /Authentication failed|could not read (Username|Password)|Permission denied \(publickey|terminal prompts disabled|Invalid username or password|HTTP Basic: Access denied|The requested URL returned error: 40[13]/i],
  ['RemoteUnreachable', /Could not resolve host|Connection refused|Connection timed out|Failed to connect|Could not read from remote repository|unable to access/i],
  ['PushRejected', /\[rejected\]|\[remote rejected\]|failed to push some refs/i],
  ['MergeConflict', /^CONFLICT \(|fix conflicts and then/im],
  ['IndexLocked', /index\.lock': File exists/i]
]

export function classifyGitError(stderr: string): GitErrorKind {
  return ERROR_PATTERNS.find(([, re]) => re.test(stderr))?.[0] ?? 'Unknown'
}

/** Failed git invocation. `message`, `stderr` and `args` are already redacted and safe to show/log. */
export class GitError extends Error {
  constructor(
    readonly kind: GitErrorKind,
    message: string,
    readonly args: string[] = [],
    readonly exitCode: number | null = null,
    readonly stderr = ''
  ) {
    super(redact(message))
    this.name = 'GitError'
    this.args = args.map(redact)
    this.stderr = redact(stderr)
  }
}

function isExecutableFile(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Find git on PATH ourselves, absolute dirs only, so a planted `git.exe` in a repo cwd is never run.
 * shortcut: Windows only looks for git.exe (no .cmd/.bat shims); extend if a real install needs it.
 */
export function findGit(env: NodeJS.ProcessEnv = process.env): string | null {
  const name = process.platform === 'win32' ? 'git.exe' : 'git'
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue
    const p = path.join(dir, name)
    if (isExecutableFile(p)) return p
  }
  return null
}

let resolved: string | null | undefined
/** Absolute git path, resolved once per process; `recheck` re-resolves (e.g. after the user installs git). */
export function gitPath(recheck = false): string | null {
  if (recheck || resolved === undefined) resolved = findGit()
  return resolved
}

export interface GitOptions {
  /** Repo root (or any dir for repo-less commands like `clone`, `--version`). */
  cwd: string
  /** Written to git's stdin, e.g. a commit message for `commit -F -`. */
  stdin?: string
  /** Abort kills the git process (cancel button, window close). */
  signal?: AbortSignal
  timeoutMs?: number
  /** Background reads (status/log polling): sets GIT_OPTIONAL_LOCKS=0 so we never block the user's git. */
  background?: boolean
  /** Base env instead of process.env (tests pass an isolated env). */
  env?: NodeJS.ProcessEnv
}

export interface GitResult {
  stdout: string
  stderr: string
}

/** Run `git <args>`; resolves on exit 0, otherwise rejects with a GitError. */
export function git(args: string[], opts: GitOptions): Promise<GitResult> {
  const bin = gitPath()
  if (!bin) return Promise.reject(new GitError('GitNotFound', 'Git was not found on PATH', args))
  const env = {
    ...(opts.env ?? process.env),
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
    LANG: 'C',
    TERM: 'dumb',
    ...(opts.background ? { GIT_OPTIONAL_LOCKS: '0' } : {})
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env,
      shell: false,
      windowsHide: true,
      signal: opts.signal,
      timeout: opts.timeoutMs
    })
    let stdout = ''
    let stderr = ''
    let tooLarge = false
    const collect = (append: (s: string) => void) => (chunk: Buffer) => {
      append(chunk.toString('utf8'))
      if (stdout.length + stderr.length > MAX_OUTPUT && !tooLarge) {
        tooLarge = true
        child.kill()
      }
    }
    child.stdout.on('data', collect((s) => (stdout += s)))
    child.stderr.on('data', collect((s) => (stderr += s)))
    child.stdin.on('error', () => {}) // git may exit before reading stdin (EPIPE); the exit code tells the story
    child.stdin.end(opts.stdin ?? '')
    child.on('error', (err) => {
      if (err.name === 'AbortError') reject(new GitError('Cancelled', 'Git operation was cancelled', args))
      else reject(new GitError('Unknown', `Failed to start git: ${err.message}`, args))
    })
    child.on('close', (code, signal) => {
      if (opts.signal?.aborted) return reject(new GitError('Cancelled', 'Git operation was cancelled', args))
      if (tooLarge) return reject(new GitError('OutputTooLarge', 'Git output exceeded the size limit', args))
      if (code === 0) return resolve({ stdout, stderr })
      if (code === null && signal === 'SIGTERM' && opts.timeoutMs)
        return reject(new GitError('Timeout', `Git timed out after ${opts.timeoutMs} ms`, args))
      const msg = stderr.trim() || `git ${args[0] ?? ''} exited with code ${code ?? signal}`
      reject(new GitError(classifyGitError(stderr), msg, args, code, stderr))
    })
  })
}

/**
 * Prefix user-supplied revisions/refs so git never parses them as options (git >= 2.24).
 * Paths go after `--` instead. Rejects empty values, `-` and NUL bytes.
 * Note: `rev-parse` echoes `--end-of-options` unless used with `--verify`.
 */
export function endOfOptions(...values: string[]): string[] {
  for (const v of values) if (!v || v === '-' || v.includes('\0')) throw new GitError('Unknown', `Invalid argument: ${JSON.stringify(v)}`)
  return ['--end-of-options', ...values]
}

/** -1 / 0 / 1 for dotted numeric versions ("2.45.1"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return Math.sign(d)
  }
  return 0
}

/** "git version 2.39.3 (Apple Git-146)" / "git version 2.45.1.windows.1" -> "2.39.3" / "2.45.1". */
export function parseGitVersion(output: string): string | null {
  return /git version (\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1] ?? null
}
