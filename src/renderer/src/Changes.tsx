import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { GridList, GridListItem, ListLayout, Virtualizer } from 'react-aria-components'
import type { FileChange, RepoEntry } from '../../shared/ipc'
import a from './App.module.css'
import s from './Changes.module.css'
import { DiffView } from './DiffView'

/** Letter shown in the list: index side first, untracked shows as added. */
export const statusLetter = (f: FileChange) => (f.conflicted ? 'U' : (f.staged ?? (f.unstaged === '?' ? 'A' : f.unstaged)) ?? 'M')

/** Changes tab (PLAN.md 3.5): file list in the sidebar, diff of the selected file in the main pane. */
export function ChangesView({ repo }: { repo: RepoEntry }) {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['status', repo.id], queryFn: () => window.gitdock['changes:status']({ repo: repo.id }) })
  useEffect(
    () =>
      window.gitdock.on('repo:changed', (e) => {
        if (e.repo !== repo.id) return
        void qc.invalidateQueries({ queryKey: ['status', repo.id] })
        void qc.invalidateQueries({ queryKey: ['diff', repo.id] })
      }),
    [qc, repo.id]
  )
  const files = status.data ?? []
  const [picked, setPicked] = useState<string | null>(null)
  const selected = files.find((f) => f.path === picked) ?? files[0]

  return (
    <>
      <aside className={a.side}>
        <div className={s.listHeader}>{files.length === 1 ? '1 changed file' : `${files.length} changed files`}</div>
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
      </aside>
      <section className={a.main}>
        {status.error ? (
          <p role="alert" className={s.empty}>
            {status.error.message}
          </p>
        ) : selected ? (
          <DiffView key={selected.path} repo={repo.id} file={selected} />
        ) : (
          status.data && <p className={s.empty}>No local changes</p>
        )}
      </section>
    </>
  )
}
