// GitHub texts main and renderer share: the renderer matches these error messages by equality.

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
