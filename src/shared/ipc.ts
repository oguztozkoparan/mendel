// The IPC contract: the only place to add a channel.
// - `invoke`: renderer -> main request/response. Request schema is zod-parsed in main on every call;
//   the response type is declared with `res<T>()` (main is trusted, so no runtime check).
// - `events`: main -> renderer pushes, payload type only.
// Main must implement every `invoke` channel (see src/main/ipc/index.ts); preload exposes each one as
// `window.mendel['<channel>'](req)` and `window.mendel.on('<event>', cb)`.
import { z } from 'zod'
import { SHA_PREFIX, TRAILER_KEY } from './historyQuery'
import { GERRIT_OPS, MAX_TERM, MAX_TERMS, MAX_TEXT } from './gerritQuery'
import { draftSchema, HASHTAG, PUSH_OPTION_VALUE, type GerritChange, type GerritCommit, type GerritSent, type GerritChangeLists, type GerritComment, type GerritConnected, type GerritDiff, type GerritFiles, type GerritRelated, type GerritSearchPage } from './gerrit'
import type { GithubDeviceCode, GithubPulls, GithubSignedIn } from './github'

const res = <Res>() => <Req extends z.ZodType>(req: Req) => ({ req, res: null as unknown as Res })

export interface AppInfo {
  version: string
  platform: string
  /** Window has native vibrancy/Mica; the renderer keeps its root transparent. */
  glass: boolean
}

/** `supported`: >= MIN_GIT_VERSION (usable); `outdated`: < RECOMMENDED_GIT_VERSION (security warning). */
export type GitInfo =
  | { found: false }
  | { found: true; path: string; version: string; supported: boolean; outdated: boolean }

/** A git/ssh credential prompt shown as an in-app modal; answer with `auth:respond`. */
export interface AuthPrompt {
  id: string
  /** text: username; secret: password/passphrase; confirm: yes/no (unknown SSH host key). */
  kind: 'text' | 'secret' | 'confirm'
  prompt: string
  /** Which op and repo asked, e.g. `git fetch in /path/repo`. */
  context: string
}

/** A repo the user added via the native dialog (TECH.md §6.2: the renderer only ever sends its `id`). */
export interface RepoEntry {
  id: string
  path: string
  name: string
  /** false when the folder was deleted/moved: shown greyed with Locate / Remove. */
  exists: boolean
  /** Set for a linked worktree (`name` is then its main repo's name): main worktree path and branch (null = detached). */
  worktree?: { main: string; branch: string | null }
}

export interface CloneProgress {
  /** git's phase, e.g. "Receiving objects". */
  phase: string
  percent: number
}

/** porcelain v2 XY letter; '?' = untracked, 'U' = unmerged. */
export type StatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'

/** One changed path. A path can have both staged and unstaged changes (e.g. after staging one hunk). */
export interface FileChange {
  path: string
  /** Source path of a staged rename/copy. */
  origPath?: string
  staged: StatusCode | null
  unstaged: StatusCode | null
  conflicted: boolean
}

export interface CommitInfo {
  /** null when HEAD is detached. */
  branch: string | null
  /** "Name <email>" git will commit as; null if user.name/email are not set. */
  author: string | null
  /** Full message of HEAD (amend prefill); null before the first commit. */
  head: string | null
}

export interface BranchInfo {
  name: string
  /** e.g. "origin/main"; null when the branch has no upstream. */
  upstream: string | null
  ahead: number
  behind: number
  /** Path of the other worktree this branch is checked out in (git refuses to switch to it here). */
  worktree?: string
}

/** One entry of `git worktree list` (bare entries skipped). */
export interface WorktreeInfo {
  /** As git reports it; send back unchanged to open/remove. */
  path: string
  /** null when detached. */
  branch: string | null
  /** HEAD sha; null before the first commit. */
  head: string | null
  /** The main worktree (cannot be removed). */
  main: boolean
  /** The worktree of the repo that asked. */
  current: boolean
  /** Lock reason ('' = locked without one); null = not locked. */
  locked: string | null
  /** Its folder is gone: `git worktree prune` drops it. */
  prunable: boolean
}

export interface Branches {
  /** null when HEAD is detached. */
  current: string | null
  /** Short sha of HEAD (shown when detached); null before the first commit. */
  head: string | null
  /** Current branch first. */
  local: BranchInfo[]
  /** Remote-tracking branches, e.g. "origin/feature". */
  remote: string[]
  /** "Stash & switch" left changes for the current branch: show Restore / Discard. */
  stash: boolean
}

export interface StashEntry {
  /** Stash commit; also works with `history:commit` / `history:diff`. */
  sha: string
  /** e.g. "On main: wip" / "WIP on main: abc123 subject". */
  message: string
  date: number
}

/** Toolbar sync button state (PLAN.md 3.4). */
export interface SyncState {
  /** null when detached. */
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  /** Without an upstream: commits on HEAD that are on no remote-tracking branch (what Gerrit's Send for review pushes); else = ahead. */
  unpushed: number
  /** Remote fetch/publish use (upstream's, else origin, else first); null = repo has no remote. */
  remote: string | null
  /** ms epoch of the last fetch (FETCH_HEAD mtime). */
  lastFetched: number | null
}

/** rejected = push refused as non-fast-forward (pull first); conflict = merge/rebase stopped on conflicts. */
export type SyncResult = 'ok' | 'rejected' | 'conflict'

/** One line of an interactive rebase todo; `message` = the new message for `reword`. */
export interface RebaseStep {
  sha: string
  action: 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'
  message?: string
}

export interface CommitSummary {
  sha: string
  short: string
  summary: string
  author: string
  /** ms epoch (author date). */
  date: number
  /** Parent SHAs (first parent first; none for a root commit). */
  parents: string[]
  /** Not on any remote-tracking branch yet. */
  unpushed: boolean
}

export interface CommitDetail {
  sha: string
  parents: string[]
  /** "Name <email>" */
  author: string
  authorDate: number
  committer: string
  committerDate: number
  message: string
  /** Changes against the first parent. status: git's letter (A/M/D/R/C/T); add/del: line counts (absent for binary files). */
  files: { path: string; origPath?: string; status: string; add?: number; del?: number }[]
}

export interface TagInfo {
  name: string
  /** Commit the tag points at (peeled for annotated tags). */
  sha: string
  annotated: boolean
}

/** One line of `git blame --porcelain`; line number = index + 1. */
export interface BlameLine {
  sha: string
  author: string
  /** ms epoch (author date). */
  date: number
  text: string
}

/** A merge, rebase, cherry-pick or revert stopped on conflicts (or otherwise waiting to be continued). */
export type OpInProgress = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null

/** User preferences (PLAN.md §6), persisted in userData/settings.json. Each field is validated on load and on change. */
const prefs = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    accent: z.enum(['cyan', 'cobalt', 'violet', 'fuchsia', 'graphite']),
    reopenLastRepo: z.boolean(),
    confirmDiscard: z.boolean(),
    /** 0 = off. */
    autoFetchMinutes: z.union([z.literal(0), z.literal(5), z.literal(15), z.literal(30)]),
    /** Pull strategy for repos without a provider. */
    pullStrategy: z.enum(['merge', 'rebase']),
    summaryLimit: z.number().int().min(20).max(200),
    spellcheck: z.boolean(),
    /** Vertical guide at column 72 in the commit description. */
    descriptionRuler: z.boolean(),
    /** Changes diff shows spaces/tabs as · / →. */
    showWhitespace: z.boolean(),
    autoUpdateCheck: z.boolean(),
    /** Gerrit Reviews tab auto-refresh. */
    reviewsRefreshMinutes: z.union([z.literal(1), z.literal(5), z.literal(15), z.literal(30)]),
    /** OS notification for new incoming reviews while the window is unfocused. */
    reviewNotifications: z.boolean(),
    /** 'system' (OS default), 'custom' (`editorPath`) or a detected tool id (`app:tools`). */
    editor: z.string().min(1).max(64),
    /** Custom editor executable; set only through the native picker in main (`settings:pickTool`). */
    editorPath: z.string().max(4096),
    terminal: z.string().min(1).max(64),
    terminalPath: z.string().max(4096)
  })
  .strict()
export type Settings = z.output<typeof prefs>
export const settingsFields = prefs.shape

/** An installed editor/terminal mendel can launch. */
export interface ExternalTool {
  id: string
  name: string
}

/** Native menu items / accelerators (PLAN.md §7) the renderer acts on; sent as `menu:command`. */
export type MenuCommand =
  | 'tab:changes'
  | 'tab:history'
  | 'tab:provider'
  | 'repo:selector'
  | 'repo:open'
  | 'repo:clone'
  | 'repo:reveal'
  | 'repo:editor'
  | 'repo:terminal'
  | 'branch:selector'
  | 'branch:new'
  | 'sync:fetch'
  | 'sync:pull'
  | 'sync:push'
  | 'sync:rebase'
  | 'changes:discardAll'
  | 'status:refresh'
  | 'settings'

/** Hosting provider of a repo (PLAN.md §5). 'gerrit' and 'github' (github.com) are implemented; 'bitbucket' is reserved. */
export type ProviderId = 'gerrit' | 'github' | 'bitbucket'

/** Result of provider detection for a repo. `baseUrl` null = REST unknown (UI asks for "Set Gerrit URL"). */
export interface Detection {
  provider: ProviderId
  /** Remote name the provider matched, e.g. `origin`. */
  remote: string
  host: string
  baseUrl: string | null
  project: string
  serverVersion?: string
  /** User from an SSH remote (prefills the credentials dialog). */
  user?: string
}

/** Per-repo provider override (PLAN.md §4.3 step 5). */
export interface RepoOverride {
  provider: 'auto' | 'gerrit' | 'none'
  baseUrl?: string
}

/** Gerrit hints for the commit box (PLAN.md §4.6). */
export interface GerritCommitHint {
  /** A commit-msg hook exists, so it adds the Change-Id (else mendel does). */
  hook: boolean
  /** HEAD is unpushed and has no Change-Id: offer "Add Change-Id to last commit". */
  headMissingChangeId: boolean
  /** HEAD is unpushed and its Change-Id belongs to this open change: amend uploads a new patch set of it. */
  patchsetOf: number | null
}

export interface ProviderState {
  /** null = no provider (none detected, or override 'none'). */
  detection: Detection | null
  override: RepoOverride
  /** Username of the stored Gerrit credential for the base URL's host; null = not connected. */
  credentialUser: string | null
}

const repoId = z.string().min(1).max(64)
const byId = z.object({ id: repoId }).strict()
/** Repo-relative path; main additionally checks it with resolveUnder (TECH.md §6.4). */
const relPath = z.string().min(1).max(4096)
const inRepo = z.object({ repo: repoId }).strict()
/** Worktree path as `worktree:list` returned it; main only acts on it if `git worktree list` reports it for that repo. */
const worktreePath = z.string().min(1).max(4096)
/** Main validates further (known branch, `git check-ref-format --branch`, no leading `-`). */
const branchName = z.string().min(1).max(255)
const sha = z.string().regex(/^[0-9a-f]{7,64}$/)
const logQuery = z.string().min(1).max(1000).regex(/^[^\0]*$/)
/** Parsed History search (shared/historyQuery.ts); main passes values only as `--opt=value` args or after `--`. */
const historyQuery = z
  .object({
    text: logQuery.optional(),
    author: logQuery.optional(),
    committer: logQuery.optional(),
    trailers: z.array(z.object({ key: z.string().regex(TRAILER_KEY), value: logQuery, prefix: z.boolean().optional() }).strict()).max(20).optional(),
    sha: z.string().regex(SHA_PREFIX).optional(),
    path: relPath.optional(),
    before: logQuery.max(100).optional(),
    after: logQuery.max(100).optional()
  })
  .strict()
const paths = z.object({ repo: repoId, paths: z.array(relPath).min(1).max(100_000) }).strict()
/** `all`: Stage all / Unstage all on the whole tree, no path list (so no 100k cap). */
const pathsOrAll = z.union([paths, z.object({ repo: repoId, all: z.literal(true) }).strict()])
const changeNum = z.number().int().positive().max(2 ** 31)
const hashtag = z.string().min(1).max(100).regex(HASHTAG)
const revision = z.string().regex(/^(?:[0-9a-f]{40}|\d{1,9}|current)$/)
/** Update checker state (PLAN.md §3.12). `canInstall: false` = "Download" opens the download page instead. */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; version: string }
  | { status: 'available'; version: string; notes: string; canInstall: boolean }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

export const invoke = {
  'app:info': res<AppInfo>()(z.undefined()),
  /** Write text to the OS clipboard (the renderer's clipboard permission is denied, TECH.md §6.1). */
  'app:copy': res<void>()(z.object({ text: z.string().max(100_000) }).strict()),
  'git:info': res<GitInfo>()(z.object({ recheck: z.boolean() }).strict().optional()),
  /** value null = cancel (git/ssh then fails with AuthFailed). For `confirm` prompts send 'yes'. */
  'auth:respond': res<void>()(z.object({ id: z.string().max(64), value: z.string().max(4096).nullable() }).strict()),
  /** Recent repos, most recent first; `current` = last opened repo if it still exists (reopened on launch). */
  'repo:list': res<{ repos: RepoEntry[]; current: string | null }>()(z.undefined()),
  /** Native folder dialog -> open that repo (subfolder opens its top level). `locate` re-points a missing entry. null = cancelled. */
  'repo:add': res<RepoEntry | null>()(z.object({ locate: repoId.optional() }).strict().optional()),
  'repo:open': res<RepoEntry>()(byId),
  'repo:remove': res<void>()(byId),
  /** Show the repo (or `path` in it) in Finder / Explorer / the file manager. */
  'repo:reveal': res<void>()(z.object({ id: repoId, path: relPath.optional() }).strict()),
  /** Open the repo root (or `path` in it) in the editor chosen in Settings. */
  'repo:openEditor': res<void>()(z.object({ repo: repoId, path: relPath.optional() }).strict()),
  'repo:openTerminal': res<void>()(inRepo),
  /** Folder clones go into (absolute, for display). `pick` shows the native folder dialog first. */
  'repo:cloneParent': res<string>()(z.object({ pick: z.boolean() }).strict()),
  /** Clone into `<cloneParent>/<name>`, then open it. Progress via `repo:cloneProgress`. */
  'repo:clone': res<RepoEntry>()(z.object({ url: z.string().min(1).max(2048), name: z.string().min(1).max(255) }).strict()),
  'repo:cloneCancel': res<void>()(z.undefined()),
  /** Working tree status; also (re)starts the file watcher for this repo (`repo:changed`). */
  'changes:status': res<FileChange[]>()(inRepo),
  /** Unified diff text: staged = HEAD..index, else index..worktree (untracked: whole file as added). */
  'changes:diff': res<string>()(
    z.object({ repo: repoId, path: relPath, origPath: relPath.optional(), staged: z.boolean(), untracked: z.boolean() }).strict()
  ),
  /** Stage whole files (include a rename's origPath). */
  'changes:stage': res<void>()(pathsOrAll),
  'changes:unstage': res<void>()(pathsOrAll),
  /**
   * Apply one hunk, identified by its `@@ ... @@` header line as shown in the diff. `discard` asks a native confirm first.
   * `lines`: only these change lines (indexes into the hunk's lines, `\ No newline` markers not counted);
   * `texts`: those lines as shown, sign included (`+x`), so main refuses if the fresh diff has other lines there.
   */
  'changes:applyHunk': res<void>()(
    z
      .object({
        repo: repoId,
        path: relPath,
        origPath: relPath.optional(),
        untracked: z.boolean(),
        hunk: z.string().startsWith('@@').max(4096),
        action: z.enum(['stage', 'unstage', 'discard']),
        lines: z.array(z.number().int().nonnegative()).min(1).max(100_000).optional(),
        texts: z.array(z.string().max(1_000_000)).max(100_000).optional()
      })
      .strict()
      .refine((r) => r.lines?.length === r.texts?.length, { message: 'texts must match lines' })
  ),
  /** Discard all changes to these files after a native confirm; false = user cancelled. */
  'changes:discard': res<boolean>()(paths),
  /**
   * Discard all changes (or only `paths`) after the renderer's confirm, into a backup stash "Discarded changes <date>".
   * Untracked files only with `untracked`. Refused during a merge/rebase/cherry-pick/revert. Resolves with the backup stash sha; null = nothing to discard.
   */
  'changes:discardAll': res<string | null>()(z.object({ repo: repoId, paths: z.array(relPath).min(1).max(100_000).optional(), untracked: z.boolean() }).strict()),
  /** Native right-click menu for a changed file (discard, ignore, reveal, open in editor, copy path); main runs the pick. */
  'changes:menu': res<void>()(z.object({ repo: repoId, path: relPath, origPath: relPath.optional(), untracked: z.boolean() }).strict()),
  'commit:info': res<CommitInfo>()(inRepo),
  /** Message = `summary\n\ndescription\n`, sent to `git commit -F -`; hook failures reject with git's stderr. */
  'commit:create': res<void>()(
    z
      .object({ repo: repoId, summary: z.string().trim().min(1).max(1000), description: z.string().max(100_000), amend: z.boolean() })
      .strict()
  ),
  'branch:list': res<Branches>()(inRepo),
  /** Create (from current HEAD, or `from` = a listed local/remote branch) and switch to it. */
  'branch:create': res<void>()(z.object({ repo: repoId, name: branchName, from: branchName.optional() }).strict()),
  /** Switch to a listed branch; if local changes block it, main asks "Stash & switch". false = user cancelled. */
  'branch:switch': res<boolean>()(z.object({ repo: repoId, name: branchName }).strict()),
  /** Delete a non-current local branch after a native confirm. false = user cancelled. */
  'branch:delete': res<boolean>()(z.object({ repo: repoId, name: branchName }).strict()),
  /** All stashes, newest first. */
  'stash:list': res<StashEntry[]>()(inRepo),
  /** Apply, pop or drop (native confirm first; false = cancelled) the stash with commit `sha`; 'conflict' = apply/pop left unmerged files. */
  'stash:action': res<SyncResult | false>()(z.object({ repo: repoId, sha, action: z.enum(['apply', 'pop', 'drop']), index: z.boolean().optional() }).strict()),
  /** Restore (pop) or discard (confirm first) the current branch's "Stash & switch" changes. false = cancelled. */
  'branch:stash': res<boolean>()(z.object({ repo: repoId, action: z.enum(['restore', 'discard']) }).strict()),
  'worktree:list': res<WorktreeInfo[]>()(inRepo),
  /** Parent folder new worktrees go into (default: next to the main worktree). `pick` shows the native folder dialog first. */
  'worktree:parent': res<string>()(z.object({ repo: repoId, pick: z.boolean() }).strict()),
  /**
   * `git worktree add` into `<parent>/<folder>`: a new branch `branch` (from listed branch `base`, else HEAD) when `create`,
   * else the listed local/remote branch `branch`. `open`: open it (resolves with its entry), else null.
   */
  'worktree:add': res<RepoEntry | null>()(
    z.object({ repo: repoId, branch: branchName, create: z.boolean(), base: branchName.optional(), folder: z.string().min(1).max(255), open: z.boolean() }).strict()
  ),
  /** Open a worktree `git worktree list` reports for `repo` (adds it to recents). */
  'worktree:open': res<RepoEntry>()(z.object({ repo: repoId, path: worktreePath }).strict()),
  /** Remove a listed linked worktree after a native confirm (and a second one to force when it has changes); false = cancelled. */
  'worktree:remove': res<boolean>()(z.object({ repo: repoId, path: worktreePath }).strict()),
  /** `git worktree prune`: drop entries whose folder is gone. */
  'worktree:prune': res<void>()(inRepo),
  'sync:state': res<SyncState>()(inRepo),
  /** Long ops below are cancellable with `sync:cancel`; git auth prompts arrive via `auth:prompt`. */
  /** `auto`: background auto-fetch; never prompts for credentials and is skipped while another op runs. */
  'sync:fetch': res<void>()(z.object({ repo: repoId, auto: z.boolean().optional() }).strict()),
  /** null = the user declined "Stash & pull". */
  'sync:pull': res<SyncResult | null>()(inRepo),
  /** Push to upstream, or publish (`push -u`) when the branch has none. */
  /** null = the user declined the Gerrit direct-push confirm. */
  'sync:push': res<SyncResult | null>()(inRepo),
  /** Fetch + rebase the current branch onto its upstream; a dirty tree asks "Stash & rebase" (null = cancelled). */
  'sync:rebase': res<SyncResult | null>()(inRepo),
  'sync:cancel': res<void>()(z.undefined()),
  /** Current branch history (or `ref` = listed local/remote branch), newest first, pages of 100. `query`: History search (ANDed parts); `path`: one file, following renames (wins over `query.path`). */
  'history:log': res<CommitSummary[]>()(
    z.object({ repo: repoId, skip: z.number().int().min(0).max(10_000_000), query: historyQuery.optional(), path: relPath.optional(), ref: branchName.optional() }).strict()
  ),
  'history:commit': res<CommitDetail>()(z.object({ repo: repoId, sha }).strict()),
  /** Read-only diff of one file of a commit (against its first parent). */
  'history:diff': res<string>()(z.object({ repo: repoId, sha, path: relPath, origPath: relPath.optional() }).strict()),
  'tag:list': res<TagInfo[]>()(inRepo),
  /** Tag commit `sha`; a non-empty `message` makes it annotated. Main validates the name (check-ref-format, no leading `-`). */
  'tag:create': res<void>()(z.object({ repo: repoId, name: branchName, sha, message: z.string().max(100_000).optional() }).strict()),
  /** Delete a listed local tag after a native confirm. false = user cancelled. */
  'tag:delete': res<boolean>()(z.object({ repo: repoId, name: branchName }).strict()),
  /** Push a listed tag to the sync remote; cancellable with `sync:cancel`. */
  'tag:push': res<void>()(z.object({ repo: repoId, name: branchName }).strict()),
  /** Per-line author/commit of a file as of a commit. */
  'history:blame': res<BlameLine[]>()(z.object({ repo: repoId, sha, path: relPath }).strict()),
  /** Apply one commit onto HEAD (`cherry-pick`) or undo it with a new commit (`revert`); 'conflict' = the conflict banner takes over. */
  'history:pick': res<SyncResult>()(z.object({ repo: repoId, sha, op: z.enum(['cherry-pick', 'revert']) }).strict()),
  /** HEAD's commits on no remote-tracking branch, oldest first (interactive rebase dialog). */
  'history:unpushed': res<GerritCommit[]>()(inRepo),
  /** Interactive rebase of exactly the unpushed commits (`steps` oldest first); a dirty tree asks "Stash & rebase" (null = cancelled). */
  'history:rebase': res<SyncResult | null>()(
    z
      .object({
        repo: repoId,
        steps: z
          .array(z.object({ sha, action: z.enum(['pick', 'reword', 'squash', 'fixup', 'drop']), message: z.string().max(100_000).optional() }).strict())
          .min(1)
          .max(100)
      })
      .strict()
  ),
  'conflict:state': res<OpInProgress>()(inRepo),
  /** Continue the merge/rebase/cherry-pick/revert once all files are marked resolved (`changes:stage`); 'conflict' = stopped again. */
  'conflict:continue': res<SyncResult>()(inRepo),
  /** Abort after a native confirm; false = cancelled. */
  'conflict:abort': res<boolean>()(inRepo),
  'settings:get': res<Settings>()(z.undefined()),
  /** Change some preferences; resolves with all of them. */
  /** Custom tool paths are not settable from the renderer (TECH.md §6.2): see `settings:pickTool`. */
  'settings:set': res<Settings>()(prefs.omit({ editorPath: true, terminalPath: true }).partial()),
  /** Installed editors and terminals for Settings → General. */
  'settings:tools': res<{ editors: ExternalTool[]; terminals: ExternalTool[] }>()(z.undefined()),
  /** Native file picker for a custom editor/terminal executable; resolves with all settings (unchanged if cancelled). */
  'settings:pickTool': res<Settings>()(z.object({ kind: z.enum(['editor', 'terminal']) }).strict()),
  /** Global git identity used for commits (`git config --global user.name/email`). */
  'settings:gitIdentity': res<{ name: string; email: string }>()(z.undefined()),
  'settings:setGitIdentity': res<void>()(
    z.object({ name: z.string().trim().min(1).max(200).regex(/^[^\0-\x1f]*$/), email: z.string().trim().min(1).max(200).regex(/^[^\0-\x1f\s<>]*$/) }).strict()
  ),
  'settings:openLogs': res<void>()(z.undefined()),
  /** Detect the repo's provider (cached per host; probes unknown hosts, 3 s timeout). */
  'provider:get': res<ProviderState>()(inRepo),
  /** Save the repo override; a base URL is probed first and rejected if it is not Gerrit. */
  'provider:setOverride': res<ProviderState>()(
    z.object({ repo: repoId, provider: z.enum(['auto', 'gerrit', 'none']), baseUrl: z.string().max(2048).nullable() }).strict()
  ),
  /** Test `GET /a/accounts/self` with Basic auth, then store the secret in the OS keychain (401: nothing stored). */
  'gerrit:connect': res<GerritConnected>()(
    z.object({ repo: repoId, baseUrl: z.string().min(1).max(2048), username: z.string().min(1).max(256), password: z.string().min(1).max(4096) }).strict()
  ),
  'gerrit:disconnect': res<void>()(inRepo),
  /** GitHub sign-in is per host, not per repo. Start the device flow (cancels one in flight): the code to type on github.com. */
  'github:signIn': res<GithubDeviceCode>()(z.undefined()),
  /** Poll until the user authorizes; rejects with GITHUB_CODE_EXPIRED, GITHUB_ACCESS_DENIED or another readable message. */
  'github:wait': res<GithubSignedIn>()(z.undefined()),
  'github:cancel': res<void>()(z.undefined()),
  /** Open https://github.com/login/device in the browser. */
  'github:openDevicePage': res<void>()(z.undefined()),
  /** Open https://github.com/apps/mendel-desktop/installations/new in the browser. */
  'github:openInstallPage': res<void>()(z.undefined()),
  /** Forget the stored token (local only). */
  'github:signOut': res<void>()(z.undefined()),
  /** Login of the stored GitHub token, null = signed out. */
  'github:account': res<string | null>()(z.undefined()),
  /** First page of the repo's open pull requests (project from main's detection); 403/404 reject with GITHUB_NOT_VISIBLE. */
  'github:pulls': res<GithubPulls>()(inRepo),
  /** Open https://github.com/<owner>/<repo>/pull/<number> in the browser (url built in main). */
  'github:openPull': res<void>()(z.object({ repo: repoId, number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()),
  /** Same-repo pull request only: main re-reads its head branch from the API and checks it out on `pr/<number>` tracking `<remote>/<head.ref>`; null = cancelled. */
  'github:checkout': res<string | null>()(z.object({ repo: repoId, number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()),
  /** Open https://github.com/<owner>/<repo>/pulls in the browser (url built in main). */
  'github:openPulls': res<void>()(inRepo),
  /** Open https://github.com/<owner>/<repo>/compare/<upstream branch>?expand=1 for the current branch (url built in main); rejects unless its upstream is on the GitHub remote. */
  'github:createPull': res<void>()(inRepo),
  'gerrit:commitHint': res<GerritCommitHint>()(inRepo),
  /** Amend only HEAD's message to add a Change-Id (HEAD must be unpushed). */
  'gerrit:addChangeId': res<void>()(inRepo),
  /** Send-for-review dialog data: default target (upstream branch) and the commits a push would send. */
  'gerrit:pending': res<{ target: string | null; commits: GerritCommit[]; headChange: { number: number; wip: boolean } | null }>()(inRepo),
  /** Fetch patch set `patchSet` and switch to `change/<change>-ps<patchSet>` tracking `<remote>/<branch>`; null = cancelled. */
  'gerrit:checkout': res<string | null>()(z.object({ repo: repoId, change: changeNum, patchSet: changeNum, branch: branchName }).strict()),
  /** History badges: sha → number of the open change with that commit's Change-Id (unpushed commits only). */
  'gerrit:badges': res<Record<string, number>>()(inRepo),
  /** `git push <remote> HEAD:refs/for/<target>%<options>`; refused when nothing is ahead or a commit lacks a Change-Id. */
  'gerrit:send': res<GerritSent>()(
    z
      .object({
        repo: repoId,
        target: branchName,
        topic: z.string().max(255).regex(PUSH_OPTION_VALUE).optional(),
        reviewers: z.array(z.string().max(255).regex(PUSH_OPTION_VALUE)).max(50),
        wip: z.boolean(),
        ready: z.boolean()
      })
      .strict()
  ),
  /** Open `<baseUrl>/<path>` (or an absolute URL on the same origin) in the browser; other origins are dropped. */
  'gerrit:open': res<void>()(z.object({ repo: repoId, path: z.string().min(1).max(4096) }).strict()),
  /** Reviews lists; `projectOnly` adds `project:"<p>"` to each query. */
  'gerrit:changes': res<GerritChangeLists>()(z.object({ repo: repoId, projectOnly: z.boolean() }).strict()),
  /** Reviews History page (shared/gerritQuery.ts): main builds the Gerrit query from allow-listed operators, every value quoted. */
  'gerrit:search': res<GerritSearchPage>()(
    z
      .object({
        repo: repoId,
        projectOnly: z.boolean(),
        start: z.number().int().min(0).max(10_000),
        query: z
          .object({
            text: z.string().min(1).max(MAX_TEXT).regex(/^[^\0-\x1f\x7f]*$/).optional(),
            terms: z.array(z.object({ op: z.enum(GERRIT_OPS), value: z.string().min(1).max(MAX_TERM) }).strict()).max(MAX_TERMS).optional()
          })
          .strict()
      })
      .strict()
  ),
  /** Change detail: all revisions, detailed labels, permitted_labels, actions, messages. */
  'gerrit:change': res<GerritChange>()(z.object({ repo: repoId, change: changeNum }).strict()),
  /** Files of a patch set (`revision` = sha or number), optionally against patch set `base`. */
  'gerrit:files': res<GerritFiles>()(z.object({ repo: repoId, change: changeNum, revision, base: changeNum.optional() }).strict()),
  'gerrit:diff': res<GerritDiff>()(z.object({ repo: repoId, change: changeNum, revision, path: z.string().min(1).max(4096), base: changeNum.optional() }).strict()),
  'gerrit:comments': res<GerritComment[]>()(z.object({ repo: repoId, change: changeNum }).strict()),
  /** Related changes (relation chain) of the current patch set. */
  /** The signed-in account's id (`accounts/self`), null if Gerrit omits it. */
  'gerrit:self': res<number | null>()(inRepo),
  'gerrit:related': res<GerritRelated[]>()(z.object({ repo: repoId, change: changeNum }).strict()),
  /** Reply: one review POST on `patchSet` with message, votes and its inline comments (drafts on older patch sets go to those). */
  'gerrit:review': res<void>()(
    z
      .object({
        repo: repoId,
        change: changeNum,
        patchSet: changeNum,
        message: z.string().max(100_000),
        labels: z.record(z.string().min(1).max(200), z.number().int().min(-99).max(99)),
        comments: z.array(draftSchema).max(1000)
      })
      .strict()
  ),
  /** Submit / abandon (optional message) / server rebase; the UI offers only actions the server listed. */
  'gerrit:action': res<void>()(
    z.object({ repo: repoId, change: changeNum, action: z.enum(['submit', 'abandon', 'rebase']), message: z.string().max(100_000).optional() }).strict()
  ),
  /** Add an account to the attention set or remove one ("self" = the signed-in user); Gerrit 3.3+. */
  'gerrit:attention': res<void>()(
    z.object({ repo: repoId, change: changeNum, account: z.union([z.literal('self'), z.number().int().positive().max(2 ** 31)]), add: z.boolean() }).strict()
  ),
  /** Add / remove hashtags; resolves with the change's hashtags after the edit. */
  'gerrit:hashtags': res<string[]>()(
    z.object({ repo: repoId, change: changeNum, add: z.array(hashtag).max(50), remove: z.array(hashtag).max(50) }).strict()
  ),
  'update:state': res<UpdateState>()(z.undefined()),
  /** Manual "Check for updates"; resolves with the state after the check. */
  'update:check': res<UpdateState>()(z.undefined()),
  'update:download': res<void>()(z.undefined()),
  'update:install': res<void>()(z.undefined())
} as const

export const events = {
  'auth:prompt': null as unknown as AuthPrompt,
  /** The prompt's git run ended (or its askpass client went away): close the modal, no answer needed. */
  'auth:dismiss': null as unknown as { id: string },
  'repo:cloneProgress': null as unknown as CloneProgress,
  /** Files or index of the watched repo changed (debounced); refetch status/diffs. */
  'repo:changed': null as unknown as { repo: string },
  /** The file watcher failed (e.g. Linux inotify limit): no auto-refresh for this repo. */
  'repo:watchOff': null as unknown as { repo: string },
  /** Main made `repo` current on its own (`mendel <dir>` launch): refetch the repo list. */
  'repo:opened': null as unknown as { repo: string },
  'update:state': null as unknown as UpdateState,
  'menu:command': null as unknown as MenuCommand,
  /** A review notification was clicked: show change `change` of `repo` in Reviews. */
  'gerrit:openChange': null as unknown as { repo: string; change: number }
} as const

/**
 * Rejection value of a failed `window.mendel[...]` call when git failed: `kind` = GitError kind, `details` = redacted
 * stderr. Main encodes it after IPC_ERROR_PREFIX in the error message; preload decodes it. Other failures reject with an Error.
 */
export interface IpcError {
  message: string
  kind?: string
  details?: string
}
export const IPC_ERROR_PREFIX = 'mendel-error:'

export type InvokeChannel = keyof typeof invoke
export type EventChannel = keyof typeof events
export type Req<C extends InvokeChannel> = z.output<(typeof invoke)[C]['req']>
export type Res<C extends InvokeChannel> = (typeof invoke)[C]['res']
export type EventPayload<E extends EventChannel> = (typeof events)[E]

type Args<C extends InvokeChannel> = undefined extends z.input<(typeof invoke)[C]['req']>
  ? [req?: z.input<(typeof invoke)[C]['req']>]
  : [req: z.input<(typeof invoke)[C]['req']>]

/** Shape of `window.mendel` (built by src/preload/index.ts). */
export type MendelApi = { [C in InvokeChannel]: (...args: Args<C>) => Promise<Res<C>> } & {
  on<E extends EventChannel>(event: E, cb: (payload: EventPayload<E>) => void): () => void
}
