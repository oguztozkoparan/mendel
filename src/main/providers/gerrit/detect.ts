// Gerrit detection (PLAN.md §4.3, §5.2). Pure; network only through the injected probe.
import type { Detection, Probe, Provider } from '..'
import { projectFromPath, type Remote } from '../remotes'

/** Hosts we know are not Gerrit: never probed. */
const NOT_GERRIT = new Set(['github.com', 'bitbucket.org', 'gitlab.com'])
export const XSSI = ")]}'"

/** 'strong': SSH port 29418 (activate even if the probe fails); 'weak': Gerrit-like HTTPS path. */
export function staticHint(r: Remote): 'strong' | 'weak' | null {
  if (r.protocol === 'ssh' && r.port === 29418) return 'strong'
  if (r.protocol === 'https' && /^\/(r|a|gerrit)\//.test(r.path)) return 'weak'
  return null
}

/** HTTPS base URLs to probe, most likely first. */
export function candidates(r: Remote): string[] {
  const origin = `https://${r.host}${r.protocol === 'https' && r.port ? `:${r.port}` : ''}`
  const out = [origin, `${origin}/r`, `${origin}/gerrit`]
  const a = r.protocol === 'https' ? r.path.indexOf('/a/') : -1
  if (a > 0) out.unshift(origin + r.path.slice(0, a))
  return [...new Set(out)]
}

/**
 * `GET <base>/config/server/version` → version string if this is Gerrit (200 + XSSI prefix), else null.
 * Servers without anonymous access redirect that to /login; their authenticated `/a/` endpoint answers
 * 401 with Gerrit's Basic realm, which also identifies Gerrit ('' = version unknown until signed in).
 */
export async function probeGerrit(base: string, probe: Probe): Promise<string | null> {
  const res = await probe(`${base}/config/server/version`)
  if (!res) return null // unreachable or timed out: no second probe
  if (res.status !== 200 || !res.body.startsWith(XSSI)) {
    const auth = await probe(`${base}/a/config/server/version`)
    return auth?.status === 401 && /realm="Gerrit Code Review"/i.test(auth.auth ?? '') ? '' : null
  }
  try {
    const v: unknown = JSON.parse(res.body.slice(XSSI.length))
    return typeof v === 'string' ? v : ''
  } catch {
    return null
  }
}

/** Project = remote path minus the base URL's path prefix and the `/a/` auth prefix. */
export function projectOf(r: Remote, baseUrl: string | null): string {
  let p = r.path
  if (r.protocol === 'https' && baseUrl) {
    const prefix = new URL(baseUrl).pathname.replace(/\/+$/, '')
    if (prefix && p.startsWith(prefix + '/')) p = p.slice(prefix.length)
    p = p.replace(/^\/a\//, '/')
  }
  return projectFromPath(p)
}

export function gerritDetection(r: Remote | undefined, baseUrl: string | null, serverVersion?: string): Detection {
  return {
    provider: 'gerrit',
    remote: r?.name ?? '',
    host: r?.host ?? (baseUrl ? new URL(baseUrl).hostname : ''),
    baseUrl,
    project: r ? projectOf(r, baseUrl) : '',
    ...(serverVersion !== undefined ? { serverVersion } : {}),
    ...(r?.protocol === 'ssh' && r.user ? { user: r.user } : {})
  }
}

export const gerritProvider: Provider = {
  id: 'gerrit',
  async detect(remotes, probe) {
    for (const r of remotes) {
      if (r.protocol === 'file' || NOT_GERRIT.has(r.host.toLowerCase())) continue
      const bases = candidates(r)
      const versions = await Promise.all(bases.map((b) => probeGerrit(b, probe)))
      const i = versions.findIndex((v) => v !== null)
      if (i >= 0) return gerritDetection(r, bases[i], versions[i]!)
      if (staticHint(r) === 'strong') return gerritDetection(r, null)
    }
    return null
  }
}
