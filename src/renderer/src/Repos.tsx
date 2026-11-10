import { Check, ChevronDown, Code, FolderGit2, FolderOpen, FolderTree, SquareTerminal, X } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useState } from 'react'
import { useMenuCommand } from './menu'
import { Button, Dialog, DialogTrigger, GridList, GridListItem, Input, SearchField } from 'react-aria-components'
import type { RepoEntry } from '../../shared/ipc'
import s from './Repos.module.css'
import { PopPopover } from './motion'

export interface RepoActions {
  /** Native folder dialog; `locate` re-points a missing entry. */
  add(locate?: string): void
  open(id: string): void
  remove(id: string): void
  reveal(id: string): void
  editor(id: string): void
  terminal(id: string): void
  clone(): void
}

/** A linked worktree reads `<main repo> · <branch>`. */
export const repoLabel = (r: RepoEntry) => (r.worktree ? `${r.name} · ${r.worktree.branch ?? 'detached'}` : r.name)

/** Recent repos rows (welcome screen and repo selector). Missing folders are greyed with Locate / Remove. */
export function RepoList(p: { repos: RepoEntry[]; current: string | null; actions: RepoActions; onDone?: () => void }) {
  const { actions } = p
  const done = (f: () => void) => () => (f(), p.onDone?.())
  return (
    <GridList
      aria-label="Recent repositories"
      items={p.repos}
      className={s.list}
      onAction={(id) => {
        const r = p.repos.find((x) => x.id === id)!
        done(() => (r.exists ? actions.open(r.id) : actions.add(r.id)))()
      }}
      renderEmptyState={() => <p className={s.empty}>No matching repositories</p>}
    >
      {(r) => (
        <GridListItem id={r.id} textValue={repoLabel(r)} className={s.item}>
          <Check size={14} aria-label={r.id === p.current ? 'Current' : undefined} className={r.id === p.current ? '' : s.hidden} />
          {/* nested under its main repo's row (main lists it right after) */}
          {r.worktree && <FolderTree size={14} aria-label="Worktree" className={p.repos.some((m) => m.path === r.worktree!.main) ? s.nested : undefined} />}
          <div className={r.exists ? s.info : `${s.info} ${s.missing}`}>
            <span>{repoLabel(r)}</span>
            <small>{r.exists ? r.path : `Missing: ${r.path}`}</small>
          </div>
          {r.exists ? (
            <>
              <Button className="icon" aria-label={`Open ${repoLabel(r)} in editor`} onPress={() => actions.editor(r.id)}>
                <Code size={14} />
              </Button>
              <Button className="icon" aria-label={`Open ${repoLabel(r)} in terminal`} onPress={() => actions.terminal(r.id)}>
                <SquareTerminal size={14} />
              </Button>
              <Button className="icon" aria-label={`Reveal ${repoLabel(r)}`} onPress={() => actions.reveal(r.id)}>
                <FolderOpen size={14} />
              </Button>
            </>
          ) : (
            <Button onPress={done(() => actions.add(r.id))}>Locate…</Button>
          )}
          <Button className="icon" aria-label={`Remove ${repoLabel(r)} from list`} onPress={() => actions.remove(r.id)}>
            <X size={14} />
          </Button>
        </GridListItem>
      )}
    </GridList>
  )
}

/** Toolbar dropdown (PLAN.md 3.2): filterable recents, current marked, Open…. */
export function RepoSelector(p: { repos: RepoEntry[]; current: RepoEntry; actions: RepoActions }) {
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(false)
  useMenuCommand((c) => c === 'repo:selector' && setOpen(true))
  const f = filter.toLowerCase()
  const shown = p.repos.filter((r) => repoLabel(r).toLowerCase().includes(f) || r.path.toLowerCase().includes(f))
  return (
    <DialogTrigger isOpen={open} onOpenChange={(o) => (setOpen(o), setFilter(''))}>
      <Button className={s.trigger}>
        {p.current.worktree ? <FolderTree size={14} aria-hidden /> : <FolderGit2 size={14} aria-hidden />}
        <span className={s.triggerText}>
          <small>{p.current.worktree ? 'Current worktree' : 'Current repository'}</small>
          {repoLabel(p.current)}
        </span>
        <ChevronDown size={14} aria-hidden />
      </Button>
      <AnimatePresence>
        {open && (
          <PopPopover placement="bottom start" className={s.popover}>
            <Dialog aria-label="Repositories" className={s.menu}>
              {({ close }) => (
                <>
                  <SearchField aria-label="Filter repositories" value={filter} onChange={setFilter} autoFocus>
                    <Input placeholder="Filter" className={s.filter} />
                  </SearchField>
                  <RepoList repos={shown} current={p.current.id} actions={p.actions} onDone={close} />
                  <div className={s.menuActions}>
                    <Button onPress={() => (close(), p.actions.add())}>Open…</Button>
                    <Button onPress={() => (close(), p.actions.clone())}>Clone…</Button>
                  </div>
                </>
              )}
            </Dialog>
          </PopPopover>
        )}
      </AnimatePresence>
    </DialogTrigger>
  )
}
