import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Decoration, Diff, Hunk, parseDiff, type HunkData } from 'react-diff-view'
import 'react-diff-view/style/index.css'
import { Button } from 'react-aria-components'
import type { FileChange } from '../../shared/ipc'
import s from './Changes.module.css'

const LARGE_DIFF_LINES = 5000
// Control and bidi characters (Trojan Source) are shown as visible markers (TECH.md §6.7). Tab and CR stay.
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g
const mark = (ch: string) => `⟨U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`
export const visible = (hunks: HunkData[]): HunkData[] =>
  hunks.map((h) => ({ ...h, changes: h.changes.map((c) => ({ ...c, content: c.content.replace(INVISIBLE, mark) })) }))

/** Diff of one file: unstaged and/or staged section, depending on where its changes are. */
type Act = (p: Promise<unknown>) => void

export function DiffView({ repo, file, act }: { repo: string; file: FileChange; act: Act }) {
  return (
    <div className={s.diffPane}>
      <div className={s.fileHeader}>
        <h2>{file.origPath ? `${file.origPath} → ${file.path}` : file.path}</h2>
        <Button onPress={() => act(window.gitdock['changes:discard']({ repo, paths: file.origPath ? [file.origPath, file.path] : [file.path] }))}>
          Discard file…
        </Button>
      </div>
      {file.unstaged && <DiffSection repo={repo} file={file} act={act} staged={false} title={file.staged ? 'Unstaged changes' : null} />}
      {file.staged && <DiffSection repo={repo} file={file} act={act} staged title={file.unstaged ? 'Staged changes' : null} />}
    </div>
  )
}

function DiffSection(p: { repo: string; file: FileChange; act: Act; staged: boolean; title: string | null }) {
  const { file, staged } = p
  const q = useQuery({
    queryKey: ['diff', p.repo, file.path, staged],
    queryFn: () =>
      window.gitdock['changes:diff']({ repo: p.repo, path: file.path, origPath: file.origPath, staged, untracked: file.unstaged === '?' && !staged })
  })
  const parsed = useMemo(() => (q.data ? parseDiff(q.data)[0] : undefined), [q.data])
  const [showLarge, setShowLarge] = useState(false)
  const hunkAction = (hunk: string, action: 'stage' | 'unstage' | 'discard') =>
    p.act(window.gitdock['changes:applyHunk']({ repo: p.repo, path: file.path, origPath: file.origPath, untracked: file.unstaged === '?', hunk, action }))
  const lines = parsed?.hunks.reduce((n, h) => n + h.changes.length, 0) ?? 0

  let body
  if (q.error) body = <p role="alert" className={s.empty}>{q.error.message}</p>
  else if (!q.data && q.isPending) body = null
  else if (parsed?.isBinary || /^Binary files /m.test(q.data ?? '')) body = <p className={s.empty}>Binary file changed</p>
  else if (!parsed || parsed.hunks.length === 0) body = <p className={s.empty}>No content changes</p>
  else if (lines > LARGE_DIFF_LINES && !showLarge)
    body = (
      <p className={s.empty}>
        Large diff hidden ({lines} lines). <Button onPress={() => setShowLarge(true)}>Show anyway</Button>
      </p>
    )
  else
    body = (
      <Diff viewType="unified" diffType={parsed.type} hunks={visible(parsed.hunks)} className={s.diff}>
        {(hunks) =>
          hunks.flatMap((h) => [
            <Decoration key={`d${h.content}`} className={s.hunkHeader}>
              <span>
                <span className={s.hunkText}>{h.content}</span>
                {staged ? (
                  <Button onPress={() => hunkAction(h.content, 'unstage')}>Unstage hunk</Button>
                ) : (
                  <>
                    <Button onPress={() => hunkAction(h.content, 'discard')}>Discard hunk…</Button>
                    <Button onPress={() => hunkAction(h.content, 'stage')}>Stage hunk</Button>
                  </>
                )}
              </span>
            </Decoration>,
            <Hunk key={h.content} hunk={h} />
          ])
        }
      </Diff>
    )

  return (
    <section aria-label={staged ? 'Staged diff' : 'Unstaged diff'}>
      {p.title && <h3 className={s.sectionTitle}>{p.title}</h3>}
      {body}
    </section>
  )
}
