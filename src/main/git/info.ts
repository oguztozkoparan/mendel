import os from 'node:os'
import type { GitInfo } from '../../shared/ipc'
import { compareVersions, git, gitPath, MIN_GIT_VERSION, parseGitVersion, RECOMMENDED_GIT_VERSION } from './runner'

/** Locate git and check its version against MIN/RECOMMENDED (PLAN.md 3.1, 4.1). */
export async function gitInfo(recheck = false): Promise<GitInfo> {
  const path = gitPath(recheck)
  if (!path) return { found: false }
  const version = parseGitVersion((await git(['--version'], { cwd: os.homedir() })).stdout)
  if (!version) return { found: false }
  return {
    found: true,
    path,
    version,
    supported: compareVersions(version, MIN_GIT_VERSION) >= 0,
    outdated: compareVersions(version, RECOMMENDED_GIT_VERSION) < 0
  }
}
