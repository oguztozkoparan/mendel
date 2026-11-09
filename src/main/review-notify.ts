// OS notifications for new incoming Gerrit reviews while the window is unfocused. The Reviews tab only polls while
// mounted, so main polls the same query for the current repo. Primary target Gerrit 3.1 has no attention set: incoming only.
import { BrowserWindow, Notification } from 'electron'
import type { GerritChange } from '../shared/gerrit'
import { emit } from './ipc'
import { baseOf, gerritFor, hostOf } from './ipc/gerrit'
import log from './log'
import { credentialUser } from './providers/gerrit/credentials'
import { providerStore, saveProviderStore } from './providers/store'
import { listRepos } from './repos'
import { getSettings, onSettingsChanged } from './settings'
import { createMainWindow } from './window'

/** Changes in `incoming` not in `seen`; a host never polled before (`seen` undefined) notifies nothing (no burst). */
export function freshIncoming(seen: number[] | undefined, incoming: GerritChange[]): GerritChange[] {
  if (!seen) return []
  const s = new Set(seen)
  return incoming.filter((c) => !s.has(c._number))
}

/** Referenced until clicked/closed: a collected Notification loses its click handler. */
const live = new Set<Notification>()

async function poll(): Promise<void> {
  const repo = listRepos().current
  if (!repo || !getSettings().reviewNotifications) return
  // Same base URL and credential key as every Gerrit IPC call.
  const base = await baseOf(repo).catch(() => null) // Gerrit not active or URL not set
  if (!base) return
  const host = hostOf(base)
  if (!credentialUser(host)) return
  const { incoming } = await (await gerritFor(repo)).listChanges(null)
  if (!getSettings().reviewNotifications) return // turned off (and seen ids cleared) while the query ran
  const store = providerStore()
  const fresh = freshIncoming(store.seenIncoming[host], incoming)
  const ids = incoming.map((c) => c._number) // current set only: stays bounded
  if (ids.join() !== store.seenIncoming[host]?.join()) {
    store.seenIncoming[host] = ids
    saveProviderStore() // only on change: the store also holds the encrypted credentials
  }
  if (!Notification.isSupported() || BrowserWindow.getAllWindows().some((w) => w.isFocused())) return
  for (const c of fresh) {
    // Subject, number and project only (no comment bodies or account details).
    // Linux (libnotify) renders markup in the body; Gerrit subjects are untrusted text.
    const text = (s: string) => (process.platform === 'linux' ? s.replace(/[&<>]/g, (ch) => `&#${ch.charCodeAt(0)};`) : s)
    const n = new Notification({ title: `Review requested: #${c._number}`, body: text(`${c.subject}\n${c.project}`) })
    live.add(n)
    n.on('close', () => live.delete(n))
    n.on('click', () => {
      live.delete(n)
      const open = () => emit('gerrit:openChange', { repo, change: c._number })
      const win = BrowserWindow.getAllWindows()[0]
      // macOS keeps running with every window closed: reopen one, then open the change once it has loaded.
      if (!win) return void createMainWindow().webContents.once('did-finish-load', open)
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      open()
    })
    n.show()
  }
}

/** Poll every `reviewsRefreshMinutes`; turning notifications off forgets the seen ids so re-enabling starts quiet. */
export function startReviewNotifier(): void {
  const tick = () =>
    setTimeout(() => void poll().catch((err: unknown) => log.warn('[gerrit] review poll failed', err instanceof Error ? err.message : err)).finally(tick), getSettings().reviewsRefreshMinutes * 60_000)
  tick()
  onSettingsChanged((s) => {
    if (s.reviewNotifications || !Object.keys(providerStore().seenIncoming).length) return
    providerStore().seenIncoming = {}
    saveProviderStore()
  })
}
