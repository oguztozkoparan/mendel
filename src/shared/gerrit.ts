// Gerrit REST shapes we use (Gerrit >= 2.15, primary target 3.1.3; no attention set / submit_requirements).
// Main zod-parses every response with these (unknown keys stripped); the renderer imports the types only.
import { z } from 'zod'

/** Error text for HTTP 401; the renderer matches it to show "Connect to Gerrit" (PLAN.md §3.7, §4.9). */
export const GERRIT_AUTH_ERROR = 'Wrong username or HTTP password / token'

export const accountSchema = z.object({
  _account_id: z.number().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  username: z.string().optional()
})
export type GerritAccount = z.infer<typeof accountSchema>

export interface GerritConnected {
  name: string
  email: string
  /** false = OS keychain unavailable (e.g. Linux without a keyring): kept for this session only. */
  persisted: boolean
}

const ts = z.string() // "2026-11-03 10:00:00.000000000" (UTC)
const voteSchema = accountSchema.extend({ value: z.number().optional() })
export const labelSchema = z.object({
  approved: accountSchema.optional(),
  rejected: accountSchema.optional(),
  recommended: accountSchema.optional(),
  disliked: accountSchema.optional(),
  /** DETAILED_LABELS: every reviewer's vote. */
  all: z.array(voteSchema).optional(),
  /** DETAILED_LABELS: value (e.g. "+1", " 0") → description. */
  values: z.record(z.string(), z.string()).optional(),
  default_value: z.number().optional()
})
export const actionSchema = z.object({ method: z.string().optional(), label: z.string().optional(), title: z.string().optional(), enabled: z.boolean().optional() })
export const revisionSchema = z.object({
  _number: z.number(),
  ref: z.string().optional(),
  created: ts.optional(),
  uploader: accountSchema.optional(),
  commit: z.object({ subject: z.string().optional(), message: z.string().optional() }).optional(),
  /** CURRENT_ACTIONS: submit / rebase / cherrypick … (only on the current revision). */
  actions: z.record(z.string(), actionSchema).optional()
})
export const messageSchema = z.object({
  id: z.string(),
  author: accountSchema.optional(),
  date: ts,
  message: z.string(),
  _revision_number: z.number().optional()
})
export const changeSchema = z.object({
  id: z.string(),
  project: z.string(),
  branch: z.string(),
  topic: z.string().optional(),
  change_id: z.string(),
  subject: z.string(),
  status: z.string(), // NEW | MERGED | ABANDONED
  updated: ts,
  _number: z.number(),
  owner: accountSchema,
  work_in_progress: z.boolean().optional(),
  unresolved_comment_count: z.number().optional(),
  labels: z.record(z.string(), labelSchema).optional(),
  /** Values the caller may vote, e.g. {"Code-Review": ["-1", " 0", "+1"]}: the only source for vote pickers. */
  permitted_labels: z.record(z.string(), z.array(z.string())).optional(),
  reviewers: z.record(z.string(), z.array(accountSchema)).optional(),
  current_revision: z.string().optional(),
  revisions: z.record(z.string(), revisionSchema).optional(),
  /** CURRENT_ACTIONS change-level actions: abandon, restore, … */
  actions: z.record(z.string(), actionSchema).optional(),
  messages: z.array(messageSchema).optional()
})
export type GerritLabel = z.infer<typeof labelSchema>
export type GerritChange = z.infer<typeof changeSchema>

export interface GerritChangeLists {
  outgoing: GerritChange[]
  incoming: GerritChange[]
  closed: GerritChange[]
}

export const fileSchema = z.object({
  status: z.string().optional(), // A | D | R | C | W | absent = M
  old_path: z.string().optional(),
  binary: z.boolean().optional(),
  lines_inserted: z.number().optional(),
  lines_deleted: z.number().optional()
})
/** path → file; includes the `/COMMIT_MSG` (and `/MERGE_LIST`) pseudo files. */
export type GerritFiles = Record<string, z.infer<typeof fileSchema>>

export const diffSchema = z.object({
  meta_a: z.object({ name: z.string() }).optional(),
  meta_b: z.object({ name: z.string() }).optional(),
  change_type: z.string().optional(),
  binary: z.boolean().optional(),
  /** Blocks: `ab` common lines, `a` only old, `b` only new, `skip` = n common lines omitted. */
  content: z.array(z.object({ ab: z.array(z.string()).optional(), a: z.array(z.string()).optional(), b: z.array(z.string()).optional(), skip: z.number().optional() }))
})
export type GerritDiff = z.infer<typeof diffSchema>

export const commentSchema = z.object({
  id: z.string(),
  patch_set: z.number().optional(),
  /** PARENT = left side (base); absent = REVISION. */
  side: z.enum(['PARENT', 'REVISION']).optional(),
  /** Absent = file-level comment. */
  line: z.number().optional(),
  in_reply_to: z.string().optional(),
  message: z.string().optional(),
  updated: ts,
  author: accountSchema.optional(),
  unresolved: z.boolean().optional()
})
export type GerritComment = z.infer<typeof commentSchema> & { path: string }

/** An inline comment not yet sent (kept locally until the reply is posted). */
export const draftSchema = z
  .object({
    path: z.string().min(1).max(4096),
    patch_set: z.number().int().positive(),
    line: z.number().int().positive().optional(),
    side: z.enum(['PARENT', 'REVISION']).optional(),
    in_reply_to: z.string().max(200).optional(),
    message: z.string().trim().min(1).max(100_000),
    unresolved: z.boolean()
  })
  .strict()
export type GerritDraft = z.infer<typeof draftSchema>
