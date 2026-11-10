import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { ChevronDown, FolderPlus, GitBranch, GitBranchPlus, Lock, X } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useState, type FormEvent } from 'react'
import { Button, Dialog, DialogTrigger, GridList, GridListItem, Heading, Input, Label, SearchField, TextField } from 'react-aria-components'
import type { BranchInfo } from '../../shared/ipc'
import a from './App.module.css'
import { Segmented, Switch } from './controls'
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

/**
 * Toolbar dropdown (PLAN.md 3.3): filter, New branch…, local (current first, ahead/behind), remote (collapsed), delete;
 * worktrees (collapsed) with open / remove / prune, New worktree… (PLAN.md §11). `repoName` names new worktree folders.
 */
export function BranchSelector(p: { repo: string; repoName: string; onError(e: unknown): void }) {
  const qc = useQueryClient()
  const run = useRun(p.repo, p.onError)
  const q = useBranches(p.repo)
  const [filter, setFilter] = useState('')
  const [showRemote, setShowRemote] = useState(false)
  const [showWorktrees, setShowWorktrees] = useState(false)
  /** New-branch dialog: initial name and, for "New branch from <selected>", its start point. */
  const [creating, setCreating] = useState<{ name: string; from?: string } | null>(null)
  /** New-worktree dialog; `branch` = picked row (check it out, or branch off it), `remote` if it is a remote branch. */
  const [newWorktree, setNewWorktree] = useState<{ branch?: string; remote?: boolean } | null>(null)
  const [open, setOpen] = useState(false)
  const worktrees = useQuery({ queryKey: ['worktrees', p.repo], queryFn: () => window.mendel['worktree:list']({ repo: p.repo }), enabled: open })
  /** Opening a worktree makes it the current repo: refetch the repo list. */
  const openWorktree = (path: string) => run(window.mendel['worktree:open']({ repo: p.repo, path }).then(() => qc.invalidateQueries({ queryKey: ['repos'] })))
  useMenuCommand((c) => (c === 'branch:selector' ? setOpen(true) : c === 'branch:new' && setCreating({ name: '' })))
  const wts = worktrees.data ?? []
  const b = q.data
  const f = filter.toLowerCase()
  const local = (b?.local ?? []).filter((x) => x.name.toLowerCase().includes(f))
  const remote = (b?.remote ?? []).filter((x) => x.toLowerCase().includes(f))
  const label = b ? (b.current ?? (b.head ? `${b.head} (detached)` : 'No branch')) : '…'

  return (
    <>
      <DialogTrigger isOpen={open} onOpenChange={(o) => (setOpen(o), setFilter(''), setShowRemote(false), setShowWorktrees(false))}>
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
                              <Button className="icon" aria-label={`New worktree for ${x.name}`} onPress={() => (close(), setNewWorktree({ branch: x.name }))}>
                                <FolderPlus size={14} />
                              </Button>
                            )}
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
                              <Button className="icon" aria-label={`New worktree for ${x.name}`} onPress={() => (close(), setNewWorktree({ branch: x.name, remote: true }))}>
                                <FolderPlus size={14} />
                              </Button>
                            </GridListItem>
                          )}
                        </GridList>
                      )}
                      {wts.length > 1 && (
                        <Button onPress={() => setShowWorktrees(!showWorktrees)} aria-expanded={showWorktrees}>
                          Worktrees ({wts.length})
                        </Button>
                      )}
                      {showWorktrees && (
                        <GridList
                          aria-label="Worktrees"
                          items={wts.map((w) => ({ ...w, id: w.path }))}
                          className={s.list}
                          onAction={(path) => {
                            const w = wts.find((x) => x.path === path)
                            if (w && !w.current && !w.prunable) (close(), openWorktree(w.path))
                          }}
                        >
                          {(w) => (
                            <GridListItem id={w.path} textValue={w.branch ?? w.path} className={s.item}>
                              <div className={w.prunable ? `${s.info} ${s.missing}` : s.info}>
                                <span>
                                  {w.current ? '✓ ' : ''}
                                  {w.branch ?? `${w.head?.slice(0, 7) ?? 'No commit'} (detached)`}
                                </span>
                                <small>
                                  {w.prunable ? 'Missing: ' : w.main ? 'Main worktree · ' : ''}
                                  {w.path}
                                </small>
                              </div>
                              {w.locked !== null && <Lock size={14} aria-label={w.locked ? `Locked: ${w.locked}` : 'Locked'} />}
                              {w.prunable ? (
                                <Button onPress={() => act(() => window.mendel['worktree:prune']({ repo: p.repo }).then(() => worktrees.refetch()))}>Prune</Button>
                              ) : (
                                !w.main &&
                                !w.current && (
                                  <Button
                                    className="icon"
                                    aria-label={`Remove worktree ${w.path}`}
                                    onPress={() => act(() => window.mendel['worktree:remove']({ repo: p.repo, path: w.path }).then(() => qc.invalidateQueries({ queryKey: ['repos'] })))}
                                  >
                                    <X size={14} />
                                  </Button>
                                )
                              )}
                            </GridListItem>
                          )}
                        </GridList>
                      )}
                      <div className={s.menuActions}>
                        <Button onPress={() => (close(), setCreating({ name: filter.trim() }))}>{b?.current ? 'New branch…' : 'Create branch here…'}</Button>
                        <Button onPress={() => (close(), setNewWorktree({}))}>New worktree…</Button>
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
        {newWorktree !== null && (
          <WorktreeDialog
            repo={p.repo}
            repoName={p.repoName}
            branch={newWorktree.branch}
            remote={newWorktree.remote}
            current={label}
            onClose={() => setNewWorktree(null)}
            onCreated={(opened) => (setNewWorktree(null), void (opened ? qc.invalidateQueries({ queryKey: ['repos'] }) : refreshRepo(qc, p.repo)))}
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

/**
 * New worktree (PLAN.md §11): from the menu, a new branch off the current one; from a branch row, check that branch out
 * (a remote one as a local tracking branch) or branch off it. Folder = `<parent>/<repo>-<branch>`, parent picked in main.
 */
function WorktreeDialog(p: { repo: string; repoName: string; branch?: string; remote?: boolean; current: string; onClose(): void; onCreated(opened: boolean): void }) {
  const parent = useQuery({ queryKey: ['worktreeParent', p.repo], queryFn: () => window.mendel['worktree:parent']({ repo: p.repo, pick: false }) })
  const [mode, setMode] = useState<'existing' | 'new'>(p.branch ? 'existing' : 'new')
  const [name, setName] = useState('')
  const [folder, setFolder] = useState<string | null>(null) // null = follow the branch name
  const [openIt, setOpenIt] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // shortcut: assumes remote names have no '/', like main's switch.
  const branch = mode === 'existing' ? (p.remote ? p.branch!.slice(p.branch!.indexOf('/') + 1) : p.branch!) : name.trim()
  const dir = folder ?? (branch ? `${p.repoName}-${branch.replace(/[\\/:*?"<>|\s]+/g, '-')}` : '')
  const pick = () => void window.mendel['worktree:parent']({ repo: p.repo, pick: true }).then(() => parent.refetch())
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const req = mode === 'existing' ? { branch: p.branch!, create: false } : { branch, create: true, base: p.branch }
    window.mendel['worktree:add']({ repo: p.repo, ...req, folder: dir, open: openIt }).then(
      (entry) => p.onCreated(!!entry),
      (err: Error) => (setBusy(false), setError(err.message))
    )
  }
  return (
    <DialogShell isDismissable={!busy} onOpenChange={(o) => !o && p.onClose()} className={a.backdrop}>
      <Dialog className={a.dialog} aria-labelledby="new-worktree-title">
        <form onSubmit={submit} className={a.form}>
          <Heading slot="title" id="new-worktree-title">
            New worktree
          </Heading>
          {p.branch && <Segmented<'existing' | 'new'> label="Branch" value={mode} options={[['existing', `Check out ${p.branch}`], ['new', 'New branch']]} onChange={setMode} />}
          {mode === 'new' && (
            <>
              <TextField value={name} onChange={setName} autoFocus isDisabled={busy} className={a.field}>
                <Label>Branch name</Label>
                <Input spellCheck={false} />
              </TextField>
              <small className={a.muted}>From {p.branch ?? p.current}</small>
            </>
          )}
          <div className={a.field}>
            <span>Parent folder</span>
            <div className={a.row}>
              <code className={a.path}>{parent.data ?? '…'}</code>
              <Button onPress={pick} isDisabled={busy}>
                Choose…
              </Button>
            </div>
          </div>
          <TextField value={dir} onChange={setFolder} isDisabled={busy} className={a.field}>
            <Label>Folder name</Label>
            <Input spellCheck={false} />
          </TextField>
          <Switch isSelected={openIt} onChange={setOpenIt} isDisabled={busy}>
            Open after creating
          </Switch>
          {error && (
            <p role="alert" className={a.error}>
              {error}
            </p>
          )}
          <div className={a.actions}>
            <Button onPress={p.onClose} isDisabled={busy}>
              Cancel
            </Button>
            <Button type="submit" className="primary" isDisabled={busy || !branch || !dir.trim()}>
              {busy ? 'Creating…' : 'Create worktree'}
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
