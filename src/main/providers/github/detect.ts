// GitHub detection: github.com remotes only (no probe; Enterprise hosts are not matched).
import type { Provider } from '..'
import { projectFromPath } from '../remotes'

const HOSTS = new Set(['github.com', 'ssh.github.com'])
const PART = /^[A-Za-z0-9_.-]+$/

export const githubProvider: Provider = {
  id: 'github',
  async detect(remotes) {
    for (const r of remotes) {
      if (r.protocol === 'file' || !HOSTS.has(r.host.toLowerCase())) continue
      const project = projectFromPath(r.path)
      const parts = project.split('/')
      if (parts.length !== 2 || !parts.every((p) => PART.test(p) && p !== '.' && p !== '..')) continue
      return { provider: 'github', remote: r.name, host: r.host, baseUrl: 'https://api.github.com', project }
    }
    return null
  }
}
