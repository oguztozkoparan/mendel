import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyGitError, compareVersions, endOfOptions, findGit, GitError, parseGitVersion } from '../../src/main/git/runner'

describe('git runner helpers', () => {
  it('parses and compares versions', () => {
    expect(parseGitVersion('git version 2.39.3 (Apple Git-146)\n')).toBe('2.39.3')
    expect(parseGitVersion('git version 2.45.1.windows.1')).toBe('2.45.1')
    expect(parseGitVersion('nope')).toBeNull()
    expect(compareVersions('2.30', '2.30.0')).toBe(0)
    expect(compareVersions('2.29.9', '2.30.0')).toBe(-1)
    expect(compareVersions('2.100.0', '2.50.1')).toBe(1)
  })

  it('classifies stderr', () => {
    expect(classifyGitError('fatal: not a git repository (or any of the parent directories): .git')).toBe('NotARepository')
    expect(classifyGitError("fatal: detected dubious ownership in repository at '/x'")).toBe('DubiousOwnership')
    expect(classifyGitError("fatal: Authentication failed for 'https://h/x.git/'\nfatal: Could not read from remote repository.")).toBe('AuthFailed')
    expect(classifyGitError('git@h: Permission denied (publickey).\nfatal: Could not read from remote repository.')).toBe('AuthFailed')
    expect(classifyGitError('Host key verification failed.\nfatal: Could not read from remote repository.')).toBe('HostKeyVerificationFailed')
    expect(classifyGitError("fatal: unable to access 'https://h/': Could not resolve host: h")).toBe('RemoteUnreachable')
    expect(classifyGitError(' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs')).toBe('PushRejected')
    expect(classifyGitError('CONFLICT (content): Merge conflict in a.txt')).toBe('MergeConflict')
    expect(classifyGitError("fatal: Unable to create '/r/.git/index.lock': File exists.")).toBe('IndexLocked')
    expect(classifyGitError('something else')).toBe('Unknown')
  })

  it('redacts credentials in GitError', () => {
    const e = new GitError('AuthFailed', "fatal: Authentication failed for 'https://u:pw@h/x'", ['clone', 'https://u:pw@h/x'], 128, 'https://u:pw@h')
    expect(JSON.stringify([e.message, e.args, e.stderr])).not.toContain('pw')
  })

  it('guards user values with --end-of-options', () => {
    expect(endOfOptions('main', '--upload-pack=x')).toEqual(['--end-of-options', 'main', '--upload-pack=x'])
    for (const bad of ['', '-', 'a\0b']) expect(() => endOfOptions(bad)).toThrow(GitError)
  })

  it('finds git only in absolute PATH dirs', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gitdock-path-'))
    try {
      const bin = path.join(dir, 'bin')
      mkdirSync(bin)
      const name = process.platform === 'win32' ? 'git.exe' : 'git'
      writeFileSync(path.join(bin, name), '')
      chmodSync(path.join(bin, name), 0o755)
      expect(findGit({ PATH: ['relative/bin', '', bin].join(path.delimiter) })).toBe(path.join(bin, name))
      expect(findGit({ PATH: 'bin' })).toBeNull()
      expect(findGit({ PATH: '' })).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
