import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { ChevronDown, GitBranch, GitBranchPlus, X } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useState, type FormEvent } from 'react'
import { Button, Dialog, DialogTrigger, GridList, GridListItem, Heading, Input, Label, SearchField, TextField } from 'react-aria-components'
import type { BranchInfo } from '../../shared/ipc'
import a from './App.module.css'
import { useMenuCommand } from './menu'
import s from './Repos.module.css'
import { DialogShell, PopPopover } from './motion'

/** Refetch every query of this repo (keys are `[kind, repoId, ...]`) after a git write; History refetches only its first page. */
export const refreshRepo = (qc: QueryClient, repo: string) => {
  qc.setQueriesData<InfiniteData<unknown[], number>>({ queryKey: ['history', repo] }, (d) => d && { pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) })
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === repo })
}

const LOCAL = new Set(['status', 'diff', 'commitInfo', 'sync', 'branches', 'conflict', 'stashes'])
/**
 * Files, index or refs changed on disk: refetch local git state only. Provider/Gerrit queries (incl. the commit hint)
 * refresh on interval, focus, HEAD change or explicit ops instead of every save.
 */
export const refreshLocal = (qc: QueryClient, repo: string) =>
  qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === repo && LOCAL.has(q.queryKey[0] as string) && q.queryKey[2] !== 'gerrit' })

export const useBranches = (repo: string) => useQuery({ queryKey: ['branches', repo], queryFn: () => window.mendel['branch:list']({ repo }) })

/** Run a branch write; refresh the repo afterwards and report errors. */
function useRun(repo: string, onError: (e: unknown) => void) {
  const qc = useQueryClient()
  return (p: Promise<unknown>) => void p.catch(onError).finally(() => refreshRepo(qc, repo))
}

export const aheadBehind = (b: Pick<BranchInfo, 'ahead' | 'behind'>) => [b.behind ? `↓${b.behind}` : '', b.ahead ? `↑${b.ahead}` : ''].filter(Boolean).join(' ')

/** Toolbar dropdown (PLAN.md 3.3): filter, New branch…, local (current first, ahead/behind), remote (collapsed), delete. */
export function BranchSelector(p: { repo: string; onError(e: unknown): void }) {
  const qc = useQueryClient()
  const run = useRun(p.repo, p.onError)
  const q = useBranches(p.repo)
  const [filter, setFilter] = useState('')
  const [showRemote, setShowRemote] = useState(false)
  /** New-branch dialog: initial name and, for "New branch from <selected>", its start point. */
  const [creating, setCreating] = useState<{ name: string; from?: string } | null>(null)
  const [open, setOpen] = useState(false)
  useMenuCommand((c) => (c === 'branch:selector' ? setOpen(true) : c === 'branch:new' && setCreating({ name: '' })))
  const b = q.data
  const f = filter.toLowerCase()
  const local = (b?.local ?? []).filter((x) => x.name.toLowerCase().includes(f))
  const remote = (b?.remote ?? []).filter((x) => x.toLowerCase().includes(f))
  const label = b ? (b.current ?? (b.head ? `${b.head} (detached)` : 'No branch')) : '…'

  return (
    <>
      <DialogTrigger isOpen={open} onOpenChange={(o) => (setOpen(o), setFilter(''), setShowRemote(false))}>
        <Button className={s.trigger} aria-label={`Current branch ${label}`}>
          <GitBranch size={14} aria-hidden />
          <span className={s.triggerText}>
            <small>Current branch</small>
            {label}
          </span>
          <ChevronDown size={14} aria-hidden />
        </Button>
        <AnimatePresence>
          {open && (
            <PopPopover placement="bottom start" className={s.popover}>
              <Dialog aria-label="Branches" className={s.menu}>
                {({ close }) => {
                  const act = (fn: () => Promise<unknown>) => (close(), run(fn()))
                  return (
                    <>
                      <SearchField aria-label="Filter branches" value={filter} onChange={setFilter} autoFocus>
                        <Input placeholder="Filter" className={s.filter} />
                      </SearchField>
                      <GridList
                        aria-label="Local branches"
                        items={local}
                        className={s.list}
                        onAction={(name) => act(() => window.mendel['branch:switch']({ repo: p.repo, name: String(name) }))}
                        renderEmptyState={() =>
                          filter.trim() ? (
                            <Button className={s.empty} onPress={() => (close(), setCreating({ name: filter.trim() }))}>
                              Create branch '{filter.trim()}'
                            </Button>
                          ) : (
                            <p className={s.empty}>No branches</p>
                          )
                        }
                      >
                        {(x) => (
                          <GridListItem id={x.name} textValue={x.name} className={s.item}>
                            <div className={s.info}>
                              <span>
                                {x.name === b?.current ? '✓ ' : ''}
                                {x.name}
                              </span>
                            </div>
                            {aheadBehind(x) && <small aria-label="ahead/behind">{aheadBehind(x)}</small>}
                            <Button className="icon" aria-label={`New branch from ${x.name}`} onPress={() => (close(), setCreating({ name: '', from: x.name }))}>
                              <GitBranchPlus size={14} />
                            </Button>
                            {x.name !== b?.current && (
                              <Button className="icon" aria-label={`Delete ${x.name}`} onPress={() => act(() => window.mendel['branch:delete']({ repo: p.repo, name: x.name }))}>
                                <X size={14} />
                              </Button>
                            )}
                          </GridListItem>
                        )}
                      </GridList>
                      {remote.length > 0 && (
                        <Button onPress={() => setShowRemote(!showRemote)} aria-expanded={showRemote}>
                          Remote branches ({remote.length})
                        </Button>
                      )}
                      {showRemote && (
                        <GridList
                          aria-label="Remote branches"
                          items={remote.map((name) => ({ name }))}
                          className={s.list}
                          onAction={(name) => act(() => window.mendel['branch:switch']({ repo: p.repo, name: String(name) }))}
                        >
                          {(x) => (
                            <GridListItem id={x.name} textValue={x.name} className={s.item}>
                              <div className={s.info}>{x.name}</div>
                              <Button className="icon" aria-label={`New branch from ${x.name}`} onPress={() => (close(), setCreating({ name: '', from: x.name }))}>
                                <GitBranchPlus size={14} />
                              </Button>
                            </GridListItem>
                          )}
                        </GridList>
                      )}
                      <div className={s.menuActions}>
                        <Button onPress={() => (close(), setCreating({ name: filter.trim() }))}>{b?.current ? 'New branch…' : 'Create branch here…'}</Button>
                      </div>
                    </>
                  )
                }}
              </Dialog>
            </PopPopover>
          )}
        </AnimatePresence>
      </DialogTrigger>
      <AnimatePresence>
        {creating !== null && (
          <NewBranchDialog
            initial={creating.name}
            from={creating.from ?? label}
            onClose={() => setCreating(null)}
            create={(name) => window.mendel['branch:create']({ repo: p.repo, name, from: creating.from }).then(() => refreshRepo(qc, p.repo))}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function NewBranchDialog(p: { initial: string; from: string; onClose(): void; create(name: string): Promise<unknown> }) {
  const [name, setName] = useState(p.initial)
  const [error, setError] = useState<string | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    p.create(name.trim()).then(p.onClose, (err: Error) => setError(err.message))
  }
  return (
    <DialogShell isDismissable onOpenChange={(o) => !o && p.onClose()} className={a.backdrop}>
      <Dialog className={a.dialog} aria-labelledby="new-branch-title">
        <form onSubmit={submit} className={a.form}>
          <Heading slot="title" id="new-branch-title">
            New branch
          </Heading>
          <TextField value={name} onChange={setName} autoFocus className={a.field}>
            <Label>Name</Label>
            <Input spellCheck={false} />
          </TextField>
          <small className={a.muted}>From {p.from}</small>
          {error && (
            <p role="alert" className={a.error}>
              {error}
            </p>
          )}
          <div className={a.actions}>
            <Button onPress={p.onClose}>Cancel</Button>
            <Button type="submit" className="primary" isDisabled={!name.trim()}>
              Create branch
            </Button>
          </div>
        </form>
      </Dialog>
    </DialogShell>
  )
}

/** "You have stashed changes on <branch>" banner after Stash & switch (PLAN.md §2 decisions). */
export function StashBanner(p: { repo: string; onError(e: unknown): void }) {
  const run = useRun(p.repo, p.onError)
  const b = useBranches(p.repo).data
  if (!b?.stash) return null
  return (
    <div role="status" className={`${a.banner} ${a.notice}`}>
      <span>You have stashed changes on {b.current}</span>
      <Button onPress={() => run(window.mendel['branch:stash']({ repo: p.repo, action: 'restore' }))}>Restore</Button>
      <Button onPress={() => run(window.mendel['branch:stash']({ repo: p.repo, action: 'discard' }))}>Discard…</Button>
    </div>
  )
}
