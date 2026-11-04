// The IPC contract: the only place to add a channel.
// - `invoke`: renderer -> main request/response. Request schema is zod-parsed in main on every call;
//   the response type is declared with `res<T>()` (main is trusted, so no runtime check).
// - `events`: main -> renderer pushes, payload type only.
// Main must implement every `invoke` channel (see src/main/ipc/index.ts); preload exposes each one as
// `window.gitdock['<channel>'](req)` and `window.gitdock.on('<event>', cb)`.
import { z } from 'zod'

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

export const invoke = {
  'app:info': res<AppInfo>()(z.undefined()),
  'git:info': res<GitInfo>()(z.object({ recheck: z.boolean() }).strict().optional()),
  /** value null = cancel (git/ssh then fails with AuthFailed). For `confirm` prompts send 'yes'. */
  'auth:respond': res<void>()(z.object({ id: z.string().max(64), value: z.string().max(4096).nullable() }).strict())
} as const

export const events = {
  'auth:prompt': null as unknown as AuthPrompt
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
