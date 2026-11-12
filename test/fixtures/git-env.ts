import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Env that isolates git from the developer's config (TECH.md §5): own HOME, own global gitconfig,
 * no system config, and no inherited GIT_* variables (e.g. GIT_DIR when tests run inside a git hook).
 */
export function isolatedGitEnv(dir: string): NodeJS.ProcessEnv {
  const home = path.join(dir, 'home')
  mkdirSync(home, { recursive: true })
  const gitconfig = path.join(home, '.gitconfig')
  writeFileSync(
    gitconfig,
    '[user]\n\tname = Test User\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n'
  )
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
  return { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' }
}

/**
 * The file `git config --global` reads `key` from. -z: without it git C-quotes a path with backslashes (Windows);
 * resolved: git for Windows prints forward slashes.
 */
export function globalOrigin(env: NodeJS.ProcessEnv, key: string, cwd: string): string {
  const out = execFileSync('git', ['config', '--global', '--show-origin', '-z', '--get', key], { cwd, env, encoding: 'utf8' })
  return path.resolve(out.slice('file:'.length, out.indexOf('\0')))
}
