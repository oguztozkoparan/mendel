import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Decoration, Diff, getChangeKey, Hunk, parseDiff, type GutterOptions, type HunkData } from 'react-diff-view'
import 'react-diff-view/style/index.css'
import { Button, Checkbox } from 'react-aria-components'
import type { FileChange } from '../../shared/ipc'
import s from './Changes.module.css'
import { Toggle, useSettings } from './Settings'

const LARGE_DIFF_LINES = 5000
const lineCount = (raw: string) => {
  let n = 0
  for (let i = raw.indexOf('\n'); i >= 0; i = raw.indexOf('\n', i + 1)) n++
  return n
}

/**
 * Shared large-diff gate (Changes, History, Gerrit): lines are counted on the raw text, so a huge diff is neither
 * parsed nor rendered until "Show anyway". `gate` is the notice to show instead of the diff (null = show it).
 */
export function useParsedDiff(raw: string | undefined) {
  const [showLarge, setShowLarge] = useState(false)
  const lines = useMemo(() => (raw ? lineCount(raw) : 0), [raw])
  const hidden = lines > LARGE_DIFF_LINES && !showLarge
  const parsed = useMemo(() => (raw && !hidden ? parseDiff(raw)[0] : undefined), [raw, hidden])
  const gate = hidden ? (
    <p className={s.empty}>
      Large diff hidden ({lines} lines). <Button onPress={() => setShowLarge(true)}>Show anyway</Button>
    </p>
  ) : null
  return { parsed, gate }
}
// Control and bidi characters (Trojan Source) are shown as visible markers (TECH.md §6.7). Tab and CR stay.
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g
const mark = (ch: string) => `⟨U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`
const WHITESPACE: Record<string, string> = { ' ': '·', '\t': '→   ' }
/** `whitespace`: also show spaces / tabs as · / → (Changes "Show whitespace"). */
export const visible = (hunks: HunkData[], whitespace = false): HunkData[] =>
  hunks.map((h) => ({
    ...h,
    changes: h.changes.map((c) => {
      const content = c.content.replace(INVISIBLE, mark)
      return { ...c, content: whitespace ? content.replace(/[ \t]/g, (w) => WHITESPACE[w]!) : content }
    })
  }))

/** Diff of one file: unstaged and/or staged section, depending on where its changes are. */
type Act = (p: Promise<unknown>) => void

export function DiffView({ repo, file, act }: { repo: string; file: FileChange; act: Act }) {
  const qc = useQueryClient()
  const whitespace = useSettings().data?.showWhitespace ?? false
  const setWhitespace = (showWhitespace: boolean) => void window.mendel['settings:set']({ showWhitespace }).then((v) => qc.setQueryData(['settings'], v))
  // git prints a combined (`diff --cc`) diff for unmerged files, which react-diff-view cannot parse.
  if (file.conflicted)
    return (
      <div className={s.diffPane}>
        <div className={s.fileHeader}>
          <h2>{file.path}</h2>
          <Button onPress={() => act(window.mendel['repo:openEditor']({ repo, path: file.path }))}>Open in editor</Button>
          <Button onPress={() => act(window.mendel['changes:stage']({ repo, paths: [file.path] }))}>Mark resolved</Button>
        </div>
        <p className={s.empty}>Conflicted file. Resolve the conflict markers in your editor, then mark it resolved.</p>
      </div>
    )
  return (
    <div className={s.diffPane}>
      <div className={s.fileHeader}>
        <h2>{file.origPath ? `${file.origPath} → ${file.path}` : file.path}</h2>
        <Toggle label="Show whitespace" value={whitespace} onChange={setWhitespace} />
        <Button onPress={() => act(window.mendel['changes:discard']({ repo, paths: file.origPath ? [file.origPath, file.path] : [file.path] }))}>
          Discard file…
        </Button>
      </div>
      {file.unstaged && <DiffSection repo={repo} file={file} act={act} staged={false} title={file.staged ? 'Unstaged changes' : null} whitespace={whitespace} />}
      {file.staged && <DiffSection repo={repo} file={file} act={act} staged title={file.unstaged ? 'Staged changes' : null} whitespace={whitespace} />}
    </div>
  )
}

function DiffSection(p: { repo: string; file: FileChange; act: Act; staged: boolean; title: string | null; whitespace: boolean }) {
  const { file, staged } = p
  const q = useQuery({
    queryKey: ['diff', p.repo, file.path, staged],
    queryFn: () =>
      window.mendel['changes:diff']({ repo: p.repo, path: file.path, origPath: file.origPath, staged, untracked: file.unstaged === '?' && !staged })
  })
  const { parsed, gate } = useParsedDiff(q.data)
  // Picked change lines (by change key) for line staging; dropped whenever the diff text changes.
  const [pick, setPick] = useState<{ data?: string; keys: Set<string> }>({ keys: new Set() })
  const picked = pick.data === q.data ? pick.keys : new Set<string>()
  const toggleLine = (key: string, on: boolean) => {
    const keys = new Set(picked)
    if (on) keys.add(key)
    else keys.delete(key)
    setPick({ data: q.data, keys })
  }
  const hunkAction = (hunk: string, action: 'stage' | 'unstage' | 'discard', lines?: number[]) =>
    p.act(window.mendel['changes:applyHunk']({ repo: p.repo, path: file.path, origPath: file.origPath, untracked: file.unstaged === '?', hunk, action, lines }))
  const pickedIn = (h: HunkData) => h.changes.flatMap((c, i) => (picked.has(getChangeKey(c)) ? [i] : []))
  const renderGutter = ({ change, side, renderDefault }: GutterOptions) =>
    side === 'old' && change.type !== 'normal' ? (
      <Checkbox
        aria-label={`${change.type === 'insert' ? 'Added' : 'Removed'} line ${change.lineNumber}`}
        isSelected={picked.has(getChangeKey(change))}
        onChange={(on) => toggleLine(getChangeKey(change), on)}
        className={s.checkbox}
      >
        <span className={s.box} aria-hidden>
          {picked.has(getChangeKey(change)) ? '✓' : ''}
        </span>
        {renderDefault()}
      </Checkbox>
    ) : (
      renderDefault()
    )

  let body
  if (q.error) body = <p role="alert" className={s.empty}>{q.error.message}</p>
  else if (!q.data && q.isPending) body = null
  else if (parsed?.isBinary || /^Binary files /m.test(q.data ?? '')) body = <p className={s.empty}>Binary file changed</p>
  else if (gate) body = gate
  else if (!parsed || parsed.hunks.length === 0) body = <p className={s.empty}>No content changes</p>
  else
    body = (
      <Diff
        viewType="unified"
        diffType={parsed.type}
        hunks={visible(parsed.hunks, p.whitespace)}
        selectedChanges={[...picked]}
        renderGutter={renderGutter}
        className={s.diff}
      >
        {(hunks) =>
          hunks.flatMap((h) => [
            <Decoration key={`d${h.content}`} className={s.hunkHeader}>
              <span>
                <span className={s.hunkText}>{h.content}</span>
                {pickedIn(h).length > 0 && (
                  <Button onPress={() => hunkAction(h.content, staged ? 'unstage' : 'stage', pickedIn(h))}>
                    {staged ? 'Unstage lines' : 'Stage lines'}
                  </Button>
                )}
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
