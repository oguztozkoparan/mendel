import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Trash2 } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Button, Checkbox, GridList, GridListItem, Input, ListLayout, SearchField, Virtualizer } from 'react-aria-components'
import type { FileChange, RepoEntry } from '../../shared/ipc'
import a from './App.module.css'
import { refreshLocal } from './Branches'
import { CommitBox } from './CommitBox'
import s from './Changes.module.css'
import { ConfirmDialog } from './ConfirmDialog'
import { Highlight } from './motion'
import { DiffView } from './DiffView'
import { bannerError, ErrorBanner, PaneBanners, type BannerError } from './ErrorBanner'
import { useGerritCommitHint } from './providers/gerrit/commitHint'
import type { Notice } from './SyncButton'

/** Letter shown in the list: index side first, untracked shows as added. */
export const statusLetter = (f: FileChange) => (f.conflicted ? 'U' : (f.staged ?? (f.unstaged === '?' ? 'A' : f.unstaged)) ?? 'M')

/** Changes tab (PLAN.md 3.5): file list in the sidebar, diff of the selected file in the main pane. */
const pathsOf = (fs: FileChange[]) => fs.flatMap((f) => (f.origPath ? [f.origPath, f.path] : [f.path]))
const fullyStaged = (f: FileChange) => !!f.staged && !f.unstaged

/** Case-insensitive path substring match (either side of a rename). */
export const matchFile = (query: string) => {
  const q = query.trim().toLowerCase()
  return (f: { path: string; origPath?: string }) => !q || f.path.toLowerCase().includes(q) || !!f.origPath?.toLowerCase().includes(q)
}

/** Concept .filter: recessed "Filter changed files" field with a search icon and an optional shortcut hint or match count; Escape clears (SearchField). */
export function FileFilter(p: { value: string; onChange(v: string): void; shortcut?: string; count?: string; inputRef?: RefObject<HTMLInputElement | null>; className?: string }) {
  return (
    <SearchField aria-label="Filter changed files" value={p.value} onChange={p.onChange} className={`${s.filter} ${p.className ?? ''}`}>
      <Search size={14} aria-hidden />
      <Input ref={p.inputRef} placeholder="Filter changed files" spellCheck={false} />
      {p.count && <span className={s.filterCount}>{p.count}</span>}
      {p.shortcut && <kbd aria-hidden>{p.shortcut}</kbd>}
    </SearchField>
  )
}

const mac = navigator.userAgent.includes('Mac')

/** Checkbox drawn as a box; react-aria Checkbox renders only a hidden input + our children. */
function Box(p: { label: string; selected: boolean; indeterminate: boolean; onChange(v: boolean): void }) {
  return (
    <Checkbox slot={null} aria-label={p.label} isSelected={p.selected} isIndeterminate={p.indeterminate} onChange={p.onChange} className={s.checkbox}>
      <span className={s.box} aria-hidden>
        {p.indeterminate ? '–' : p.selected ? '✓' : ''}
      </span>
    </Checkbox>
  )
}

const files_ = (n: number) => (n === 1 ? '1 file' : `${n} files`)

export function ChangesView(p: {
  repo: RepoEntry
  amend?: boolean
  onAmendDone?: () => void
  /** Repository → Discard All Changes…: open the confirm, then call onDiscardAsked. */
  discard?: boolean
  onDiscardAsked?: () => void
  onNotice(n: Notice): void
}) {
  const { repo, amend, onAmendDone } = p
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['status', repo.id], queryFn: () => window.mendel['changes:status']({ repo: repo.id }) })
  const files = status.data ?? []
  const hint = useGerritCommitHint(repo.id)
  const [query, setQuery] = useState('')
  const shown = query.trim() ? files.filter(matchFile(query)) : files
  const filterRef = useRef<HTMLInputElement>(null)
  // Mod+F (free: no menu accelerator uses it) focuses the filter; this view is mounted only while the Changes tab is active.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((mac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        filterRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const [picked, setPicked] = useState<string | null>(null)
  const selected = shown.find((f) => f.path === picked) ?? shown[0]
  const [error, setError] = useState<BannerError | null>(null)
  /** Run a git write, then refresh status + diffs; errors show in the main pane. */
  const act = (p: Promise<unknown>) => {
    setError(null)
    void p
      .catch((e) => setError(bannerError(e)))
      .finally(() => {
        void qc.invalidateQueries({ queryKey: ['status', repo.id] })
        void qc.invalidateQueries({ queryKey: ['diff', repo.id] })
      })
  }
  const setStaged = (fs: FileChange[], stage: boolean) =>
    act(window.mendel[stage ? 'changes:stage' : 'changes:unstage']({ repo: repo.id, paths: pathsOf(fs) }))
  // Select-all acts only on the files the filter shows.
  const allStaged = shown.length > 0 && shown.every(fullyStaged)
  // Discard all acts on the files the filter shows too (like Stage all shown); untracked ones only when ticked.
  const [discarding, setDiscarding] = useState(false)
  const [withUntracked, setWithUntracked] = useState(false)
  const openDiscard = () => (setWithUntracked(false), setDiscarding(true))
  const filtered = shown !== files
  const loose = shown.filter((f) => f.unstaged === '?').length
  const tracked = shown.length - loose
  useEffect(() => {
    if (!p.discard) return
    p.onDiscardAsked?.()
    if (files.length) openDiscard()
  }, [p.discard])
  const discardAll = () =>
    window.mendel['changes:discardAll']({ repo: repo.id, paths: filtered ? pathsOf(shown) : undefined, untracked: withUntracked }).then((sha) => {
      void refreshLocal(qc, repo.id)
      if (sha)
        p.onNotice({
          text: 'Changes discarded. A backup is saved in Stashes.',
          // The notice outlives this view (it follows the user across tabs): report the outcome through another notice, not local state.
          action: {
            label: 'Undo',
            run: () =>
              window.mendel['stash:action']({ repo: repo.id, sha, action: 'pop', index: true })
                .then((r) => r === 'conflict' && p.onNotice({ text: 'Backup restored with conflicts: resolve them in Changes.' }))
                .catch((e: Error) => p.onNotice({ text: `Undo failed: ${e.message}. The backup is still in Stashes.` }))
                .finally(() => refreshLocal(qc, repo.id))
          }
        })
    })
  /** PLAN.md §7: Space stages/unstages and Mod+Backspace discards the selected file while the file list has focus. */
  const onListKey = (e: KeyboardEvent) => {
    if (!selected || !(e.target as HTMLElement).closest('[aria-label="Changed files"]')) return
    if (e.key === ' ') setStaged([selected], !fullyStaged(selected))
    else if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) act(window.mendel['changes:discard']({ repo: repo.id, paths: pathsOf([selected]) }))
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <>
      <aside className={a.side} onKeyDownCapture={onListKey}>
        {files.length > 0 && <FileFilter value={query} onChange={setQuery} shortcut={mac ? '⌘F' : 'Ctrl+F'} inputRef={filterRef} className={s.sideFilter} />}
        <div className={s.listHeader}>
          {shown.length > 0 && (
            <Box
              label={shown === files ? 'Stage all' : 'Stage all shown'}
              selected={allStaged}
              indeterminate={!allStaged && shown.some((f) => f.staged)}
              onChange={(v) => (shown === files ? act(window.mendel[v ? 'changes:stage' : 'changes:unstage']({ repo: repo.id, all: true })) : setStaged(shown, v))}
            />
          )}
          {shown !== files ? `${shown.length} of ${files.length} changed files` : files.length === 1 ? '1 changed file' : `${files.length} changed files`}
          {shown.length > 0 && (
            <Button className={`icon ${s.discardAll}`} aria-label={filtered ? `Discard ${files_(shown.length)} shown…` : 'Discard all changes…'} onPress={openDiscard}>
              <Trash2 size={13} aria-hidden />
            </Button>
          )}
        </div>
        <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 30 }}>
          <GridList
            aria-label="Changed files"
            items={shown}
            selectionMode="single"
            selectionBehavior="replace"
            disallowEmptySelection
            selectedKeys={selected ? [selected.path] : []}
            onSelectionChange={(keys) => keys !== 'all' && keys.size && setPicked(String([...keys][0]))}
            className={s.list}
            renderEmptyState={() => (files.length ? <p className={s.empty}>No matching files</p> : null)}
          >
            {(f) => (
              <GridListItem
                id={f.path}
                textValue={f.path}
                className={s.row}
                onContextMenu={(e) => (e.preventDefault(), act(window.mendel['changes:menu']({ repo: repo.id, path: f.path, origPath: f.origPath, untracked: f.unstaged === '?' })))}
              >
                {({ isSelected }) => (
                  <>
                    {isSelected && <Highlight id="sel-files" />}
                    <Box label="Staged" selected={fullyStaged(f)} indeterminate={!!f.staged && !!f.unstaged} onChange={(v) => setStaged([f], v)} />
                    <span className={s.path} title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}>
                      {f.path}
                    </span>
                    <span className={s.letter} data-status={statusLetter(f)} aria-label={`status ${statusLetter(f)}`}>
                      {statusLetter(f)}
                    </span>
                  </>
                )}
              </GridListItem>
            )}
          </GridList>
        </Virtualizer>
        <CommitBox repo={repo.id} hasStaged={files.some((f) => f.staged)} hint={hint} amend={amend} onAmendDone={onAmendDone} />
      </aside>
      <section className={a.main}>
        <PaneBanners />
        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        {status.error ? (
          <p role="alert" className={s.empty}>
            {status.error.message}
          </p>
        ) : selected ? (
          <DiffView key={selected.path} repo={repo.id} file={selected} act={act} />
        ) : (
          status.data && !files.length && (
            <div className={s.empty}>
              <p>No local changes</p>
              <div className={a.row}>
                <Button onPress={() => act(window.mendel['repo:openEditor']({ repo: repo.id }))}>Open in editor</Button>
                <Button onPress={() => act(window.mendel['repo:reveal']({ id: repo.id }))}>Reveal</Button>
              </div>
            </div>
          )
        )}
      </section>
      <AnimatePresence>
        {discarding && (
          <ConfirmDialog
            key="discard-all"
            title={filtered ? `Discard ${files_(shown.length)} shown?` : 'Discard all changes?'}
            action={filtered ? 'Discard shown' : 'Discard all'}
            isDisabled={!tracked && !withUntracked}
            onConfirm={discardAll}
            onClose={() => setDiscarding(false)}
          >
            <p className={s.confirmText}>
              {tracked
                ? `${files_(tracked)} will be reset to the last commit, staged and unstaged changes alike.`
                : 'Only untracked files are left; tick below to delete them.'}
              {filtered && ' Changes the filter hides are kept.'} A backup is saved as “Discarded changes” in Stashes, so you can restore it.
            </p>
            {loose > 0 && (
              <Checkbox isSelected={withUntracked} onChange={setWithUntracked} className={`${s.amend} ${s.checkbox}`}>
                <span className={s.box} aria-hidden>
                  {withUntracked ? '✓' : ''}
                </span>
                Also delete {files_(loose)} not tracked by git (ignored files are kept)
              </Checkbox>
            )}
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </>
  )
}
