import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ChevronDown, GitBranch, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, Dialog, DialogTrigger, GridList, GridListItem, Heading, Input, Label, Modal, ModalOverlay, Popover, SearchField, TextField } from 'react-aria-components'
import type { BranchInfo } from '../../shared/ipc'
import a from './App.module.css'
import { useMenuCommand } from './menu'
import s from './Repos.module.css'

/** Refetch every query of this repo (keys are `[kind, repoId, ...]`) after a git write. */
export const refreshRepo = (qc: QueryClient, repo: string) => qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === repo })

export const useBranches = (repo: string) => useQuery({ queryKey: ['branches', repo], queryFn: () => window.gitdock['branch:list']({ repo }) })

/** Run a branch write; refresh the repo afterwards and report errors. */
function useRun(repo: string, onError: (msg: string) => void) {
  const qc = useQueryClient()
  return (p: Promise<unknown>) => void p.catch((e: Error) => onError(e.message)).finally(() => refreshRepo(qc, repo))
}

export const aheadBehind = (b: Pick<BranchInfo, 'ahead' | 'behind'>) => [b.behind ? `↓${b.behind}` : '', b.ahead ? `↑${b.ahead}` : ''].filter(Boolean).join(' ')

/** Toolbar dropdown (PLAN.md 3.3): filter, New branch…, local (current first, ahead/behind), remote (collapsed), delete. */
export function BranchSelector(p: { repo: string; onError(msg: string): void }) {
  const qc = useQueryClient()
  const run = useRun(p.repo, p.onError)
  const q = useBranches(p.repo)
  const [filter, setFilter] = useState('')
  const [showRemote, setShowRemote] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  useMenuCommand((c) => (c === 'branch:selector' ? setOpen(true) : c === 'branch:new' && setCreating('')))
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
        <Popover placement="bottom start" className={s.popover}>
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
                    onAction={(name) => act(() => window.gitdock['branch:switch']({ repo: p.repo, name: String(name) }))}
                    renderEmptyState={() =>
                      filter.trim() ? (
                        <Button className={s.empty} onPress={() => (close(), setCreating(filter.trim()))}>
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
                        {x.name !== b?.current && (
                          <Button className="icon" aria-label={`Delete ${x.name}`} onPress={() => act(() => window.gitdock['branch:delete']({ repo: p.repo, name: x.name }))}>
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
                      onAction={(name) => act(() => window.gitdock['branch:switch']({ repo: p.repo, name: String(name) }))}
                    >
                      {(x) => (
                        <GridListItem id={x.name} textValue={x.name} className={s.item}>
                          {x.name}
                        </GridListItem>
                      )}
                    </GridList>
                  )}
                  <div className={s.menuActions}>
                    <Button onPress={() => (close(), setCreating(filter.trim()))}>{b?.current ? 'New branch…' : 'Create branch here…'}</Button>
                  </div>
                </>
              )
            }}
          </Dialog>
        </Popover>
      </DialogTrigger>
      {creating !== null && (
        <NewBranchDialog
          initial={creating}
          from={label}
          onClose={() => setCreating(null)}
          create={(name) => window.gitdock['branch:create']({ repo: p.repo, name }).then(() => refreshRepo(qc, p.repo))}
        />
      )}
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
    <ModalOverlay isOpen isDismissable onOpenChange={(o) => !o && p.onClose()} className={a.backdrop}>
      <Modal>
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
      </Modal>
    </ModalOverlay>
  )
}

/** "You have stashed changes on <branch>" banner after Stash & switch (PLAN.md §2 decisions). */
export function StashBanner(p: { repo: string; onError(msg: string): void }) {
  const run = useRun(p.repo, p.onError)
  const b = useBranches(p.repo).data
  if (!b?.stash) return null
  return (
    <div role="status" className={`${a.banner} ${a.notice}`}>
      <span>You have stashed changes on {b.current}</span>
      <Button onPress={() => run(window.gitdock['branch:stash']({ repo: p.repo, action: 'restore' }))}>Restore</Button>
      <Button onPress={() => run(window.gitdock['branch:stash']({ repo: p.repo, action: 'discard' }))}>Discard…</Button>
    </div>
  )
}
