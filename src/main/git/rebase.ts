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
 * stop and `--continue`; a failed exec, e.g. a rejecting commit-msg hook, is retried on continue, never skipped). 'conflict' = the conflict banner takes over.
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
  const message = async (sha: string) => (await git(['log', '-1', '--format=%B', sha, '--'], { cwd, env })).stdout.trimEnd()
  // A reword, or a squash, ends its group with one amend from a file. For squash the message is built here, not by git:
  // git keeps every squashed commit's Change-Id and Gerrit would take the last one, uploading to the wrong change.
  let group: { i: number; sha: string; reword?: string; squashed: string[] } | null = null
  const flush = async () => {
    if (!group || (group.reword === undefined && !group.squashed.length)) return
    const bodies = await Promise.all(group.squashed.map(async (sha) => (await message(sha)).replace(/^Change-Id:.*$\n?/gm, '').trim()))
    const file = await gitPath(rewordFile(group.i))
    await writeFile(file, [group.reword ?? (await message(group.sha)), ...bodies.filter(Boolean)].join('\n\n') + '\n')
    rewords.push(file)
    lines.push(`exec git commit --amend --only --allow-empty -F "$(git rev-parse --git-path ${rewordFile(group.i)})"`)
  }
  for (const [i, s] of steps.entries()) {
    if (s.action === 'pick' || s.action === 'reword') {
      await flush()
      group = { i, sha: s.sha, reword: s.action === 'reword' ? s.message! : undefined, squashed: [] }
    } else if (s.action === 'squash') group!.squashed.push(s.sha)
    lines.push(`${s.action === 'reword' ? 'pick' : s.action} ${s.sha}`)
  }
  await flush()
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mendel-rebase-'))
  const todo = path.join(dir, 'todo')
  await writeFile(todo, lines.join('\n') + '\n')
  try {
    const run = git(['rebase', '-i', '--reschedule-failed-exec', '--empty=drop', ...(autostash ? ['--autostash'] : []), ...(base ? [base] : ['--root'])], {
      cwd,
      // git appends the todo path: `cp "$MENDEL_REBASE_TODO" <todo>`. GIT_EDITOR=true keeps squash's combined message.
      env: { ...(env ?? process.env), GIT_SEQUENCE_EDITOR: 'cp "$MENDEL_REBASE_TODO"', MENDEL_REBASE_TODO: todo, GIT_EDITOR: 'true' }
    })
    return await conflictAware(cwd, run, env)
  } finally {
    // The files hold the user's messages: remove them unless the rebase stopped and `--continue` still reads them.
    if (!(await opInProgress(cwd, env).catch(() => null))) await Promise.all(rewords.map((f) => rm(f, { force: true })))
    await rm(dir, { recursive: true, force: true })
  }
}
