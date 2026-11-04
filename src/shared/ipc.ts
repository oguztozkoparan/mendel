// The IPC contract: the only place to add a channel.
// - `invoke`: renderer -> main request/response. Request schema is zod-parsed in main on every call;
//   the response type is declared with `res<T>()` (main is trusted, so no runtime check).
// - `events`: main -> renderer pushes, payload type only.
// Main must implement every `invoke` channel (see src/main/ipc/index.ts); preload exposes each one as
// `window.gitdock['<channel>'](req)` and `window.gitdock.on('<event>', cb)`.
import { z } from 'zod'
import type { GerritChangeLists, GerritConnected } from './gerrit'

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
const paths = z.object({ repo: repoId, paths: z.array(relPath).min(1).max(100_000) }).strict()
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
  'update:state': null as unknown as UpdateState
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
