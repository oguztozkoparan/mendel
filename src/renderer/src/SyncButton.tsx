import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useEffect, useState } from 'react'
import { Button, Menu, MenuItem, MenuTrigger } from 'react-aria-components'
import type { SyncResult } from '../../shared/ipc'
import { refreshRepo } from './Branches'
import s from './Repos.module.css'
import { useMenuCommand } from './menu'
import { Highlight, PopPopover } from './motion'
import { useSettings } from './Settings'
import { ago } from './time'

export interface Notice {
  text: string
  action?: { label: string; run(): void }
}

/** A provider's replacement for Push when ahead (PLAN.md §5.3, e.g. Gerrit "Send for review"); Push stays in the menu. */
export interface PrimaryOverride {
  label: string
  run(): void
}

type Op = 'fetch' | 'pull' | 'push' | 'rebase'
const BUSY: Record<Op, string> = { fetch: 'Fetching…', pull: 'Pulling…', push: 'Pushing…', rebase: 'Rebasing…' }

/** Menu item label with the sliding hover plate (react-aria focuses the item under the pointer). */
const item = (label: string) => ({ isFocused }: { isFocused: boolean }) => (
  <>
    {isFocused && <Highlight id="sync-menu" />}
    {label}
  </>
)

/** Toolbar sync button (PLAN.md 3.4): label follows ahead/behind; menu has every op; busy ops are cancellable. */
export function SyncButton(p: { repo: string; onError(e: unknown, retry?: () => void): void; onNotice(n: Notice | null): void; primary?: PrimaryOverride | null }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['sync', p.repo], queryFn: () => window.mendel['sync:state']({ repo: p.repo }) })
  const [busy, setBusy] = useState<Op | null>(null)
  const [menu, setMenu] = useState(false)
  const st = q.data
  const every = useSettings().data?.autoFetchMinutes ?? 0
  const hasRemote = !!st?.remote
  useEffect(() => {
    if (!every || !hasRemote) return
    const t = setInterval(
      () => void window.mendel['sync:fetch']({ repo: p.repo, auto: true }).then(() => refreshRepo(qc, p.repo), () => undefined),
      every * 60_000
    )
    return () => clearInterval(t)
  }, [every, hasRemote, p.repo, qc])

  const run = (op: Op) => {
    if (busy) return
    setBusy(op)
    p.onNotice(null)
    void window.mendel[`sync:${op}`]({ repo: p.repo })
      .then((r: SyncResult | null | void) => {
        if (r === 'rejected') p.onNotice({ text: 'Remote has new commits. Pull first.', action: { label: 'Pull', run: () => run('pull') } })
        // Conflict with no rebase/merge left in progress: re-applying the autostash conflicted.
        else if (r === 'conflict')
          void window.mendel['conflict:state']({ repo: p.repo }).then(
            (s) => !s && p.onNotice({ text: 'Your uncommitted changes conflict with the new commits. Resolve the conflicted files; your changes are also kept in the stash.' })
          )
      }, (e) => p.onError(e, () => run(op)))
      .finally(() => (setBusy(null), refreshRepo(qc, p.repo)))
  }

  const [label, op]: [string, Op | null] = !st?.remote
    ? ['No remote', null]
    : !st.branch
      ? [`Fetch ${st.remote}`, 'fetch']
      : !st.upstream
        ? ['Publish branch', 'push']
        : st.behind
          ? [`Pull ↓${st.behind}${st.ahead ? ` ↑${st.ahead}` : ''}`, 'pull']
          : st.ahead
            ? [`Push ↑${st.ahead}`, 'push']
            : [`Fetch ${st.remote}`, 'fetch']
  // Provider override (Gerrit Send for review) whenever there are unpushed commits, upstream or not.
  const primary = op === 'push' && st?.unpushed && p.primary ? { ...p.primary, label: `${p.primary.label} ↑${st.unpushed}` } : null
  useMenuCommand((c) => {
    if (c === 'sync:push' && primary) primary.run()
    else if (c === 'sync:fetch' || c === 'sync:pull' || c === 'sync:push' || c === 'sync:rebase') run(c.slice(5) as Op)
  })

  return (
    <div className={s.sync}>
      {busy ? (
        <>
          <span role="status" className={s.syncLabel}>
            {BUSY[busy]}
          </span>
          <Button onPress={() => void window.mendel['sync:cancel']()}>Cancel</Button>
        </>
      ) : (
        <Button
          className={s.trigger}
          isDisabled={!op && !primary}
          aria-label={primary?.label ?? label}
          onPress={() => (primary ? primary.run() : op && run(op))}
        >
          <span className={s.triggerText} data-tip={st?.remote ? undefined : 'This repository has no remote'}>
            {primary?.label ?? label}
            <small>{st?.lastFetched ? `Fetched ${ago(st.lastFetched)}` : st?.remote ? 'Never fetched' : ''}</small>
          </span>
        </Button>
      )}
      <MenuTrigger isOpen={menu} onOpenChange={setMenu}>
        <Button className="icon" aria-label="Sync options" isDisabled={!st?.remote || !!busy}>
          <ChevronDown size={14} />
        </Button>
        <AnimatePresence>
          {menu && (
            <PopPopover placement="bottom end" className={s.popover}>
              <Menu className={s.menu} onAction={(k) => run(k as Op)} disabledKeys={[...(st?.upstream ? [] : ['pull', 'rebase']), ...(st?.branch ? [] : ['push'])]}>
                <MenuItem id="fetch" className={s.item}>{item('Fetch')}</MenuItem>
                <MenuItem id="pull" className={s.item}>{item('Pull')}</MenuItem>
                <MenuItem id="push" className={s.item}>{item(st?.upstream ? 'Push' : 'Publish branch')}</MenuItem>
                <MenuItem id="rebase" className={s.item}>{item('Rebase onto upstream')}</MenuItem>
              </Menu>
            </PopPopover>
          )}
        </AnimatePresence>
      </MenuTrigger>
    </div>
  )
}
