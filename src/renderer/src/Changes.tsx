import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button, Checkbox, GridList, GridListItem, ListLayout, Virtualizer } from 'react-aria-components'
import type { FileChange, RepoEntry } from '../../shared/ipc'
import a from './App.module.css'
import { CommitBox } from './CommitBox'
import s from './Changes.module.css'
import { DiffView } from './DiffView'

/** Letter shown in the list: index side first, untracked shows as added. */
export const statusLetter = (f: FileChange) => (f.conflicted ? 'U' : (f.staged ?? (f.unstaged === '?' ? 'A' : f.unstaged)) ?? 'M')

/** Changes tab (PLAN.md 3.5): file list in the sidebar, diff of the selected file in the main pane. */
const pathsOf = (fs: FileChange[]) => fs.flatMap((f) => (f.origPath ? [f.origPath, f.path] : [f.path]))
const fullyStaged = (f: FileChange) => !!f.staged && !f.unstaged

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

export function ChangesView({ repo }: { repo: RepoEntry }) {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['status', repo.id], queryFn: () => window.gitdock['changes:status']({ repo: repo.id }) })
  useEffect(
    () =>
      window.gitdock.on('repo:changed', (e) => {
        if (e.repo !== repo.id) return
        void qc.invalidateQueries({ queryKey: ['status', repo.id] })
        void qc.invalidateQueries({ queryKey: ['diff', repo.id] })
        void qc.invalidateQueries({ queryKey: ['commitInfo', repo.id] })
      }),
    [qc, repo.id]
  )
  const files = status.data ?? []
  const [picked, setPicked] = useState<string | null>(null)
  const selected = files.find((f) => f.path === picked) ?? files[0]
  const [error, setError] = useState<string | null>(null)
  /** Run a git write, then refresh status + diffs; errors show in the main pane. */
  const act = (p: Promise<unknown>) => {
    setError(null)
    void p
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        void qc.invalidateQueries({ queryKey: ['status', repo.id] })
        void qc.invalidateQueries({ queryKey: ['diff', repo.id] })
      })
  }
  const setStaged = (fs: FileChange[], stage: boolean) =>
    act(window.gitdock[stage ? 'changes:stage' : 'changes:unstage']({ repo: repo.id, paths: pathsOf(fs) }))
  const allStaged = files.length > 0 && files.every(fullyStaged)

  return (
    <>
      <aside className={a.side}>
        <div className={s.listHeader}>
          {files.length > 0 && (
            <Box
              label="Stage all"
              selected={allStaged}
              indeterminate={!allStaged && files.some((f) => f.staged)}
              onChange={(v) => setStaged(files, v)}
            />
          )}
          {files.length === 1 ? '1 changed file' : `${files.length} changed files`}
        </div>
        <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 26 }}>
          <GridList
            aria-label="Changed files"
            items={files}
            selectionMode="single"
            selectionBehavior="replace"
            disallowEmptySelection
            selectedKeys={selected ? [selected.path] : []}
            onSelectionChange={(keys) => keys !== 'all' && keys.size && setPicked(String([...keys][0]))}
            className={s.list}
          >
            {(f) => (
              <GridListItem id={f.path} textValue={f.path} className={s.row}>
                <Box label="Staged" selected={fullyStaged(f)} indeterminate={!!f.staged && !!f.unstaged} onChange={(v) => setStaged([f], v)} />
                <span className={s.path} title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}>
                  {f.path}
                </span>
                <span className={s.letter} data-status={statusLetter(f)} aria-label={`status ${statusLetter(f)}`}>
                  {statusLetter(f)}
                </span>
              </GridListItem>
            )}
          </GridList>
        </Virtualizer>
        <CommitBox repo={repo.id} hasStaged={files.some((f) => f.staged)} />
      </aside>
      <section className={a.main}>
        {error && (
          <div role="alert" className={a.banner}>
            <span>{error}</span>
            <Button onPress={() => setError(null)}>Dismiss</Button>
          </div>
        )}
        {status.error ? (
          <p role="alert" className={s.empty}>
            {status.error.message}
          </p>
        ) : selected ? (
          <DiffView key={selected.path} repo={repo.id} file={selected} act={act} />
        ) : (
          status.data && <p className={s.empty}>No local changes</p>
        )}
      </section>
    </>
  )
}
