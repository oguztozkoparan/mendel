import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { RebaseStep, SyncResult } from '../../shared/ipc'
import { unpushedCommits } from '../providers/gerrit/git'
import { opInProgress } from './conflict'
import { git } from './runner'
import { conflictAware } from './sync'

const rewordFile = (i: number) => `mendel-reword-${i}`

/**
 * `git rebase -i` of HEAD's unpushed commits with a prepared todo (`steps`, oldest first): every unpushed commit exactly
 * once, onto the oldest one's parent. Editors are constant commands; data goes through env and files, never into a shell
 * string. Reword = `pick` + `exec git commit --amend` with the message from a file in the git dir (survives a conflict
 * stop and `--continue`). 'conflict' = the conflict banner takes over.
 */
export async function interactiveRebase(cwd: string, steps: RebaseStep[], autostash: boolean, env?: NodeJS.ProcessEnv): Promise<SyncResult> {
  if (await opInProgress(cwd, env)) throw new Error('Finish or abort the operation in progress first')
  const commits = await unpushedCommits(cwd, env)
  if (!commits.length) throw new Error('There are no unpushed commits to rebase')
  if (commits.length >= 100) throw new Error('Too many unpushed commits (100 or more) to edit here')
  const merges = await git(['rev-list', '--min-parents=2', 'HEAD', '--not', '--remotes', '--'], { cwd, env })
  if (merges.stdout.trim()) throw new Error('Cannot edit commits across a merge commit')
  const unpushed = new Set(commits.map((c) => c.sha))
  if (steps.length !== unpushed.size || new Set(steps.map((s) => s.sha)).size !== steps.length || !steps.every((s) => unpushed.has(s.sha)))
    throw new Error('The unpushed commits changed; reopen the dialog')
  const first = steps.find((s) => s.action !== 'drop')
  if (first && (first.action === 'squash' || first.action === 'fixup')) throw new Error(`The first commit cannot be a ${first.action}`)
  if (steps.some((s) => s.action === 'reword' && !s.message?.trim())) throw new Error('A reworded commit needs a message')

  // Linear (no merges): the oldest unpushed commit is last; its parent is the base, none = root commit.
  const oldest = commits.at(-1)!.sha
  const base = await git(['rev-parse', '--verify', '-q', `${oldest}^`], { cwd, env }).then((r) => r.stdout.trim(), () => null)
  const gitPath = async (name: string) => path.resolve(cwd, (await git(['rev-parse', '--git-path', name], { cwd, env })).stdout.trim())
  const lines: string[] = []
  const rewords: string[] = []
  for (const [i, s] of steps.entries()) {
    lines.push(`${s.action === 'reword' ? 'pick' : s.action} ${s.sha}`)
    if (s.action !== 'reword') continue
    const file = await gitPath(rewordFile(i))
    await writeFile(file, s.message!)
    rewords.push(file)
    lines.push(`exec git commit --amend --only -F "$(git rev-parse --git-path ${rewordFile(i)})"`)
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mendel-rebase-'))
  const todo = path.join(dir, 'todo')
  await writeFile(todo, lines.join('\n') + '\n')
  try {
    const run = git(['rebase', '-i', ...(autostash ? ['--autostash'] : []), ...(base ? [base] : ['--root'])], {
      cwd,
      // git appends the todo path: `cp "$MENDEL_REBASE_TODO" <todo>`. GIT_EDITOR=true keeps squash's combined message.
      env: { ...(env ?? process.env), GIT_SEQUENCE_EDITOR: 'cp "$MENDEL_REBASE_TODO"', MENDEL_REBASE_TODO: todo, GIT_EDITOR: 'true' }
    })
    const r = await conflictAware(cwd, run, env)
    // shortcut: after a conflict stop the reword files stay in the git dir (tiny; overwritten next time).
    if (r === 'ok') await Promise.all(rewords.map((f) => rm(f, { force: true })))
    return r
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
