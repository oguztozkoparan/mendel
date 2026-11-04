import { Check, ChevronDown, FolderGit2, FolderOpen, X } from 'lucide-react'
import { useState } from 'react'
import { Button, Dialog, DialogTrigger, GridList, GridListItem, Input, Popover, SearchField } from 'react-aria-components'
import type { RepoEntry } from '../../shared/ipc'
import s from './Repos.module.css'

export interface RepoActions {
  /** Native folder dialog; `locate` re-points a missing entry. */
  add(locate?: string): void
  open(id: string): void
  remove(id: string): void
  reveal(id: string): void
  clone(): void
}

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
        <GridListItem id={r.id} textValue={r.name} className={s.item}>
          <Check size={14} aria-label={r.id === p.current ? 'Current' : undefined} className={r.id === p.current ? '' : s.hidden} />
          <div className={r.exists ? s.info : `${s.info} ${s.missing}`}>
            <span>{r.name}</span>
            <small>{r.exists ? r.path : `Missing: ${r.path}`}</small>
          </div>
          {r.exists ? (
            <Button className="icon" aria-label={`Reveal ${r.name}`} onPress={() => actions.reveal(r.id)}>
              <FolderOpen size={14} />
            </Button>
          ) : (
            <Button onPress={done(() => actions.add(r.id))}>Locate…</Button>
          )}
          <Button className="icon" aria-label={`Remove ${r.name} from list`} onPress={() => actions.remove(r.id)}>
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
  const f = filter.toLowerCase()
  const shown = p.repos.filter((r) => r.name.toLowerCase().includes(f) || r.path.toLowerCase().includes(f))
  return (
    <DialogTrigger onOpenChange={() => setFilter('')}>
      <Button className={s.trigger}>
        <FolderGit2 size={14} aria-hidden />
        <span className={s.triggerText}>
          <small>Current repository</small>
          {p.current.name}
        </span>
        <ChevronDown size={14} aria-hidden />
      </Button>
      <Popover placement="bottom start" className={s.popover}>
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
      </Popover>
    </DialogTrigger>
  )
}
