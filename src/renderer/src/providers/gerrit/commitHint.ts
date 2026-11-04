import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CommitHint } from '../../CommitBox'

/** Gerrit's commit-box hint (PLAN.md §4.6): who adds the Change-Id, and a fix for an unpushed HEAD without one. */
export function useGerritCommitHint(repo: string): CommitHint | null {
  const qc = useQueryClient()
  const provider = useQuery({ queryKey: ['provider', repo], queryFn: () => window.gitdock['provider:get']({ repo }) })
  const gerrit = provider.data?.detection?.provider === 'gerrit'
  // Under 'commitInfo' so every commit / repo change refreshes it.
  const q = useQuery({ queryKey: ['commitInfo', repo, 'gerrit'], queryFn: () => window.gitdock['gerrit:commitHint']({ repo }), enabled: gerrit })
  if (!gerrit || !q.data) return null
  return {
    note: q.data.hook ? 'Change-Id: will be added by commit-msg hook' : 'Change-Id will be added by gitdock',
    fix: q.data.headMissingChangeId
      ? {
          label: 'Add Change-Id to last commit',
          run: () => window.gitdock['gerrit:addChangeId']({ repo }).then(() => qc.invalidateQueries({ predicate: (x) => x.queryKey[1] === repo }))
        }
      : undefined
  }
}
