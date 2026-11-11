// GitHub texts main and renderer share: the renderer matches these error messages by equality.
import { z } from 'zod'

/** No stored token, or GitHub rejected it and it could not be refreshed: the user has to sign in again. */
export const GITHUB_AUTH_ERROR = 'Not signed in to GitHub, or the sign-in has expired'
/** The device code expired before the user entered it: offer a new code. */
export const GITHUB_CODE_EXPIRED = 'The code has expired'
/** The user cancelled the authorization on github.com. */
export const GITHUB_ACCESS_DENIED = 'Sign-in was cancelled on GitHub'

/** `github:signIn`: the code the user types at https://github.com/login/device. */
export interface GithubDeviceCode {
  userCode: string
  /** Epoch ms. */
  expiresAt: number
}

/** `github:wait`: the signed-in account; persisted false = no OS keychain, kept for this session only. */
export interface GithubSignedIn {
  login: string
  persisted: boolean
}

/** `github:pulls` 403/404: the user token cannot see the repo, usually because the GitHub App is not installed on it. */
export const GITHUB_NOT_VISIBLE = 'The GitHub App cannot see this repository'

/** One open pull request, only the fields the Pull requests tab shows. */
export const githubPullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  user: z.object({ login: z.string() }),
  draft: z.boolean().default(false),
  html_url: z.string(),
  updated_at: z.string(),
  body: z.string().nullable(),
  // head.repo is null when the fork was deleted
  head: z.object({ ref: z.string(), repo: z.object({ full_name: z.string() }).nullable() }),
  base: z.object({ ref: z.string() })
})
export type GithubPull = z.infer<typeof githubPullSchema>

/** `github:pulls`: the first page; `more` = GitHub has further pages (Link rel="next"). */
export interface GithubPulls {
  pulls: GithubPull[]
  more: boolean
}
