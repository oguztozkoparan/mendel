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
