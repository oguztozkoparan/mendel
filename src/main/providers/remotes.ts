// Remote URL parsing (PLAN.md §5.2): ssh://, scp-style user@host:path, http(s)://, local paths.
import { git } from '../git/runner'

export interface Remote {
  name: string
  url: string
  /** http remotes count as 'https' (REST is only ever called over https, see detection). */
  protocol: 'ssh' | 'https' | 'file'
  host: string
  port?: number
  user?: string
  /** Path on the host, as written (leading `/` kept for URL forms). */
  path: string
}

const SCP = /^(?:([^@/\\]+)@)?([^/\\:]+):(?!\/\/)(.+)$/

export function parseRemote(name: string, url: string): Remote | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return null
    }
    const protocol = { 'ssh:': 'ssh', 'git+ssh:': 'ssh', 'ssh+git:': 'ssh', 'https:': 'https', 'http:': 'https', 'file:': 'file' }[u.protocol] as Remote['protocol'] | undefined
    if (!protocol) return null
    return {
      name,
      url,
      protocol,
      host: u.hostname,
      port: u.port ? Number(u.port) : undefined,
      user: u.username ? decodeURIComponent(u.username) : undefined,
      path: decodeURIComponent(u.pathname)
    }
  }
  const m = SCP.exec(url)
  // A single-letter "host" is a Windows drive (C:\repo), i.e. a local path.
  if (m && m[2].length > 1) return { name, url, protocol: 'ssh', host: m[2], user: m[1], path: m[3] }
  return { name, url, protocol: 'file', host: '', path: url }
}

/** `/p/q.git/` → `p/q`. */
export const projectFromPath = (p: string): string => p.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '')

/** Configured remotes (raw config URLs, before insteadOf rewriting), `origin` first. */
export async function readRemotes(root: string, env?: NodeJS.ProcessEnv): Promise<Remote[]> {
  const { stdout } = await git(['config', '--get-regexp', '^remote\\..*\\.url$'], { cwd: root, env, background: true, okExitCodes: [1] })
  const out: Remote[] = []
  for (const line of stdout.split('\n')) {
    const m = /^remote\.(.+)\.url (.+)$/.exec(line.trim())
    const r = m && parseRemote(m[1], m[2])
    if (r && !out.some((x) => x.name === r.name)) out.push(r)
  }
  return out.sort((a, b) => Number(b.name === 'origin') - Number(a.name === 'origin'))
}
