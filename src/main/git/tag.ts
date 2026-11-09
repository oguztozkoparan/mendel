import type { TagInfo } from '../../shared/ipc'
import { endOfOptions, git, type GitOptions } from './runner'
import { syncState } from './sync'

type Opts = Pick<GitOptions, 'env' | 'signal'>

/** All tags; `sha` is the commit an annotated tag points at. */
export async function listTags(cwd: string, env?: NodeJS.ProcessEnv): Promise<TagInfo[]> {
  const fmt = '%(refname:strip=2)%00%(objectname)%00%(*objectname)%00%(objecttype)'
  const r = await git(['for-each-ref', `--format=${fmt}`, 'refs/tags'], { cwd, env, background: true })
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name = '', obj = '', peeled = '', type] = l.split('\0')
      return { name, sha: peeled || obj, annotated: type === 'tag' }
    })
}

/** New tag names (TECH.md §6.3): no leading `-`/control chars, and `git check-ref-format refs/tags/<name>` must accept it. */
export async function validateTagName(cwd: string, name: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const bad = new Error(`Invalid tag name: ${name}`)
  if (!name || name.startsWith('-') || /[\0-\x20\x7f]/.test(name)) throw bad
  const ok = await git(['check-ref-format', `refs/tags/${name}`], { cwd, env }).then(() => true, () => false)
  if (!ok) throw bad
  return name
}

/** Throw unless `name` is an existing tag: the renderer only picks from the list. */
async function known(cwd: string, name: string, env?: NodeJS.ProcessEnv): Promise<void> {
  if (!(await listTags(cwd, env)).some((t) => t.name === name)) throw new Error(`Unknown tag: ${name}`)
}

/** Lightweight tag on commit `sha`, or annotated (`-a -F -`, message via stdin) when `message` is non-empty. */
export async function createTag(cwd: string, name: string, sha: string, message: string | undefined, env?: NodeJS.ProcessEnv): Promise<void> {
  await validateTagName(cwd, name, env)
  const target = `${sha}^{commit}`
  if (message?.trim()) await git(['tag', '-a', '-F', '-', ...endOfOptions(name, target)], { cwd, env, stdin: message })
  else await git(['tag', ...endOfOptions(name, target)], { cwd, env })
}

export async function deleteTag(cwd: string, name: string, env?: NodeJS.ProcessEnv): Promise<void> {
  await known(cwd, name, env)
  await git(['tag', '-d', ...endOfOptions(name)], { cwd, env })
}

/** Push one tag to the remote sync uses (upstream's, else origin, else first). */
export async function pushTag(cwd: string, name: string, o: Opts = {}): Promise<void> {
  await known(cwd, name, o.env)
  const { remote } = await syncState(cwd, o.env)
  if (!remote) throw new Error('This repository has no remote')
  await git(['-c', 'protocol.ext.allow=never', 'push', ...endOfOptions(remote, `refs/tags/${name}:refs/tags/${name}`)], { cwd, ...o })
}
