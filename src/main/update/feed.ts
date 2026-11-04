// Pure update-feed rules (TECH.md §4, §6.8): no electron imports, unit-tested.

export type Feed = { provider: 'github'; owner: string; repo: string } | { provider: 'generic'; url: string }

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** HTTPS only; plain http only for loopback and only when the caller allows it (unpackaged tests). */
export function urlAllowed(raw: string, allowLoopbackHttp: boolean): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.username || u.password) return false
  return u.protocol === 'https:' || (allowLoopbackHttp && u.protocol === 'http:' && LOOPBACK.has(u.hostname))
}

/**
 * Parse the flat `app-update.yml` electron-builder writes into resources/ and validate it.
 * shortcut: flat `key: value` lines only (all electron-builder emits for github/generic); use js-yaml if nested keys appear.
 */
export function parseFeed(yml: string, allowLoopbackHttp = false): Feed | null {
  const kv: Record<string, string> = {}
  for (const line of yml.split(/\r?\n/)) {
    const m = /^(\w+):\s*(.*?)\s*$/.exec(line)
    if (m) kv[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  if (kv.provider === 'github' && /^[\w.-]+$/.test(kv.owner ?? '') && /^[\w.-]+$/.test(kv.repo ?? '')) {
    return { provider: 'github', owner: kv.owner, repo: kv.repo }
  }
  if (kv.provider === 'generic' && urlAllowed(kv.url ?? '', allowLoopbackHttp)) return { provider: 'generic', url: kv.url }
  return null
}

/** Whether this build can install an update itself (else "Download" opens the download page). */
export function canSelfInstall(platform: string, o: { appImage: boolean; macAutoInstall: boolean }): boolean {
  if (platform === 'win32') return true
  if (platform === 'darwin') return o.macAutoInstall // Squirrel.Mac refuses unsigned updates
  if (platform === 'linux') return o.appImage // .deb needs root
  return false
}

/** Page or file the user downloads by hand: GitHub release page, or the platform installer on a generic host. */
export function downloadUrl(feed: Feed, version: string, files: { url: string }[], platform: string): string {
  if (feed.provider === 'github') return `https://github.com/${feed.owner}/${feed.repo}/releases/tag/v${version}`
  const ext = platform === 'darwin' ? '.dmg' : platform === 'linux' ? '.deb' : '.exe'
  const file = files.find((f) => f.url.endsWith(ext)) ?? files[0]
  const base = feed.url.endsWith('/') ? feed.url : feed.url + '/'
  return file ? new URL(file.url, base).href : base
}

/** openExternal allowlist: https (loopback http in tests) to github.com or the feed's own host. */
export function externalAllowed(raw: string, feed: Feed, allowLoopbackHttp: boolean): boolean {
  if (!urlAllowed(raw, allowLoopbackHttp)) return false
  const host = new URL(raw).host
  return feed.provider === 'github' ? host === 'github.com' : host === new URL(feed.url).host
}
