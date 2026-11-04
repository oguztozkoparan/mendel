import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from 'react-aria-components'
import a from './App.module.css'
import { refreshRepo } from './Branches'

/** Banner while a merge/rebase is stopped (PLAN.md §4.8): conflicted files with Mark resolved, Continue, Abort. */
export function ConflictBanner(p: { repo: string; onError(msg: string): void }) {
  const qc = useQueryClient()
  const op = useQuery({ queryKey: ['conflict', p.repo], queryFn: () => window.gitdock['conflict:state']({ repo: p.repo }) }).data
  const status = useQuery({ queryKey: ['status', p.repo], queryFn: () => window.gitdock['changes:status']({ repo: p.repo }), enabled: !!op })
  if (!op) return null
  const conflicted = (status.data ?? []).filter((f) => f.conflicted)
  const run = (pr: Promise<unknown>) => void pr.catch((e: Error) => p.onError(e.message)).finally(() => refreshRepo(qc, p.repo))
  return (
    <div role="status" aria-label="Conflicts" className={`${a.banner} ${a.notice} ${a.conflicts}`}>
      <span>
        <strong>{op === 'merge' ? 'Merge' : 'Rebase'} in progress.</strong>{' '}
        {conflicted.length ? `Resolve conflicts in ${conflicted.length} file${conflicted.length > 1 ? 's' : ''}, mark them resolved, then continue.` : 'All conflicts resolved.'}
        <ul>
          {conflicted.map((f) => (
            <li key={f.path}>
              <code>{f.path}</code>{' '}
              <Button onPress={() => run(window.gitdock['changes:stage']({ repo: p.repo, paths: [f.path] }))}>Mark resolved</Button>
            </li>
          ))}
        </ul>
      </span>
      <Button className="primary" isDisabled={conflicted.length > 0 || !status.data} onPress={() => run(window.gitdock['conflict:continue']({ repo: p.repo }))}>
        Continue {op}
      </Button>
      <Button onPress={() => run(window.gitdock['conflict:abort']({ repo: p.repo }))}>Abort…</Button>
    </div>
  )
}
