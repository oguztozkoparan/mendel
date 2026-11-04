// The IPC contract: the only place to add a channel.
// - `invoke`: renderer -> main request/response. Request schema is zod-parsed in main on every call;
//   the response type is declared with `res<T>()` (main is trusted, so no runtime check).
// - `events`: main -> renderer pushes, payload type only.
// Main must implement every `invoke` channel (see src/main/ipc/index.ts); preload exposes each one as
// `window.gitdock['<channel>'](req)` and `window.gitdock.on('<event>', cb)`.
import { z } from 'zod'
import { draftSchema, type GerritChange, type GerritChangeLists, type GerritComment, type GerritConnected, type GerritDiff, type GerritFiles } from './gerrit'

const res = <Res>() => <Req extends z.ZodType>(req: Req) => ({ req, res: null as unknown as Res })

export interface AppInfo {
  version: string
  platform: string
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
}

/** A repo the user added via the native dialog (TECH.md §6.2: the renderer only ever sends its `id`). */
export interface RepoEntry {
  id: string
  path: string
  name: string
  /** false when the folder was deleted/moved: shown greyed with Locate / Remove. */
  exists: boolean
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

/** Toolbar sync button state (PLAN.md 3.4). */
export interface SyncState {
  /** null when detached. */
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  /** Remote fetch/publish use (upstream's, else origin, else first); null = repo has no remote. */
  remote: string | null
  /** ms epoch of the last fetch (FETCH_HEAD mtime). */
  lastFetched: number | null
}

/** rejected = push refused as non-fast-forward (pull first); conflict = merge/rebase stopped on conflicts. */
export type SyncResult = 'ok' | 'rejected' | 'conflict'

export interface CommitSummary {
  sha: string
  short: string
  summary: string
  author: string
  /** ms epoch (author date). */
  date: number
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
  /** Changes against the first parent. status: git's letter (A/M/D/R/C/T). */
  files: { path: string; origPath?: string; status: string }[]
}

/** A merge or rebase stopped on conflicts (or otherwise waiting to be continued). */
export type OpInProgress = 'merge' | 'rebase' | null

/** User preferences (PLAN.md §6), persisted in userData/settings.json. Each field is validated on load and on change. */
const prefs = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    reopenLastRepo: z.boolean(),
    confirmDiscard: z.boolean(),
    /** 0 = off. */
    autoFetchMinutes: z.union([z.literal(0), z.literal(5), z.literal(15), z.literal(30)]),
    /** Pull strategy for repos without a provider. */
    pullStrategy: z.enum(['merge', 'rebase']),
    summaryLimit: z.number().int().min(20).max(200),
    spellcheck: z.boolean(),
    autoUpdateCheck: z.boolean()
  })
  .strict()
export type Settings = z.output<typeof prefs>
export const settingsFields = prefs.shape

/** Native menu items / accelerators (PLAN.md §7) the renderer acts on; sent as `menu:command`. */
export type MenuCommand =
  | 'tab:changes'
  | 'tab:history'
  | 'tab:provider'
  | 'repo:selector'
  | 'repo:open'
  | 'repo:clone'
  | 'repo:reveal'
  | 'branch:selector'
  | 'branch:new'
  | 'sync:fetch'
  | 'sync:pull'
  | 'sync:push'
  | 'sync:rebase'
  | 'status:refresh'
  | 'settings'

/** Hosting provider of a repo (PLAN.md §5). Only 'gerrit' is implemented; others are reserved ids. */
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
/** Main validates further (known branch, `git check-ref-format --branch`, no leading `-`). */
const branchName = z.string().min(1).max(255)
const sha = z.string().regex(/^[0-9a-f]{7,64}$/)
const paths = z.object({ repo: repoId, paths: z.array(relPath).min(1).max(100_000) }).strict()
const changeNum = z.number().int().positive().max(2 ** 31)
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
  'repo:reveal': res<void>()(byId),
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
  'changes:stage': res<void>()(paths),
  'changes:unstage': res<void>()(paths),
  /** Apply one hunk, identified by its `@@ ... @@` header line as shown in the diff. `discard` asks a native confirm first. */
  'changes:applyHunk': res<void>()(
    z
      .object({
        repo: repoId,
        path: relPath,
        origPath: relPath.optional(),
        untracked: z.boolean(),
        hunk: z.string().startsWith('@@').max(4096),
        action: z.enum(['stage', 'unstage', 'discard'])
      })
      .strict()
  ),
  /** Discard all changes to these files after a native confirm; false = user cancelled. */
  'changes:discard': res<boolean>()(paths),
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
  /** Restore (pop) or discard (confirm first) the current branch's "Stash & switch" changes. false = cancelled. */
  'branch:stash': res<boolean>()(z.object({ repo: repoId, action: z.enum(['restore', 'discard']) }).strict()),
  'sync:state': res<SyncState>()(inRepo),
  /** Long ops below are cancellable with `sync:cancel`; git auth prompts arrive via `auth:prompt`. */
  /** `auto`: background auto-fetch; never prompts for credentials and is skipped while another op runs. */
  'sync:fetch': res<void>()(z.object({ repo: repoId, auto: z.boolean().optional() }).strict()),
  'sync:pull': res<SyncResult>()(inRepo),
  /** Push to upstream, or publish (`push -u`) when the branch has none. */
  'sync:push': res<SyncResult>()(inRepo),
  /** Fetch + rebase the current branch onto its upstream; a dirty tree asks "Stash & rebase" (null = cancelled). */
  'sync:rebase': res<SyncResult | null>()(inRepo),
  'sync:cancel': res<void>()(z.undefined()),
  /** Current branch history, newest first, pages of 100. */
  'history:log': res<CommitSummary[]>()(z.object({ repo: repoId, skip: z.number().int().min(0).max(10_000_000) }).strict()),
  'history:commit': res<CommitDetail>()(z.object({ repo: repoId, sha }).strict()),
  /** Read-only diff of one file of a commit (against its first parent). */
  'history:diff': res<string>()(z.object({ repo: repoId, sha, path: relPath, origPath: relPath.optional() }).strict()),
  'conflict:state': res<OpInProgress>()(inRepo),
  /** Continue the merge/rebase once all files are marked resolved (`changes:stage`); 'conflict' = stopped again. */
  'conflict:continue': res<SyncResult>()(inRepo),
  /** Abort after a native confirm; false = cancelled. */
  'conflict:abort': res<boolean>()(inRepo),
  'settings:get': res<Settings>()(z.undefined()),
  /** Change some preferences; resolves with all of them. */
  'settings:set': res<Settings>()(prefs.partial()),
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
  /** Open `<baseUrl>/<path>` (or an absolute URL on the same origin) in the browser; other origins are dropped. */
  'gerrit:open': res<void>()(z.object({ repo: repoId, path: z.string().min(1).max(4096) }).strict()),
  /** Reviews lists; `projectOnly` adds `project:"<p>"` to each query. */
  'gerrit:changes': res<GerritChangeLists>()(z.object({ repo: repoId, projectOnly: z.boolean() }).strict()),
  /** Change detail: all revisions, detailed labels, permitted_labels, actions, messages. */
  'gerrit:change': res<GerritChange>()(z.object({ repo: repoId, change: changeNum }).strict()),
  /** Files of a patch set (`revision` = sha or number), optionally against patch set `base`. */
  'gerrit:files': res<GerritFiles>()(z.object({ repo: repoId, change: changeNum, revision, base: changeNum.optional() }).strict()),
  'gerrit:diff': res<GerritDiff>()(z.object({ repo: repoId, change: changeNum, revision, path: z.string().min(1).max(4096), base: changeNum.optional() }).strict()),
  'gerrit:comments': res<GerritComment[]>()(z.object({ repo: repoId, change: changeNum }).strict()),
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
  'update:state': res<UpdateState>()(z.undefined()),
  /** Manual "Check for updates"; resolves with the state after the check. */
  'update:check': res<UpdateState>()(z.undefined()),
  'update:download': res<void>()(z.undefined()),
  'update:install': res<void>()(z.undefined())
} as const

export const events = {
  'auth:prompt': null as unknown as AuthPrompt,
  'repo:cloneProgress': null as unknown as CloneProgress,
  /** Files or index of the watched repo changed (debounced); refetch status/diffs. */
  'repo:changed': null as unknown as { repo: string },
  'update:state': null as unknown as UpdateState,
  'menu:command': null as unknown as MenuCommand
} as const

export type InvokeChannel = keyof typeof invoke
export type EventChannel = keyof typeof events
export type Req<C extends InvokeChannel> = z.output<(typeof invoke)[C]['req']>
export type Res<C extends InvokeChannel> = (typeof invoke)[C]['res']
export type EventPayload<E extends EventChannel> = (typeof events)[E]

type Args<C extends InvokeChannel> = undefined extends z.input<(typeof invoke)[C]['req']>
  ? [req?: z.input<(typeof invoke)[C]['req']>]
  : [req: z.input<(typeof invoke)[C]['req']>]

/** Shape of `window.gitdock` (built by src/preload/index.ts). */
export type GitdockApi = { [C in InvokeChannel]: (...args: Args<C>) => Promise<Res<C>> } & {
  on<E extends EventChannel>(event: E, cb: (payload: EventPayload<E>) => void): () => void
}
