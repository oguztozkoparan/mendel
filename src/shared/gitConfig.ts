// Git identity/signing config (Settings > Git): the only keys mendel reads for display or writes. Field names cross
// IPC; main maps them to git keys here, so no other key can be read or written through src/main/git/config.ts.
import { z } from 'zod'

export const GIT_CONFIG_KEYS = {
  name: 'user.name',
  email: 'user.email',
  signingKey: 'user.signingkey',
  gpgSign: 'commit.gpgsign',
  gpgFormat: 'gpg.format'
} as const
export type GitConfigField = keyof typeof GIT_CONFIG_KEYS
export const GIT_CONFIG_FIELDS = Object.keys(GIT_CONFIG_KEYS) as GitConfigField[]

export const GPG_FORMATS = ['openpgp', 'ssh', 'x509'] as const
/** Caps: names/emails are short; a signing key may be an inline SSH public key (`key::ssh-rsa …`, ~750 chars for RSA 4096). */
export const MAX_CONFIG_NAME = 256
export const MAX_CONFIG_SIGNING_KEY = 2048

// Control characters (C0, DEL, C1, incl. newline/NUL) are rejected before trimming, so "a\n" is refused, not trimmed.
const text = (max: number) =>
  z
    .string()
    .regex(/^\P{Cc}*$/u, 'Control characters (newline, NUL, …) are not allowed')
    .trim()
    .max(max)

/** A write: '' unsets the key (inherit), an absent field is left untouched. Unknown fields are rejected. */
export const gitConfigWriteSchema = z.strictObject({
  // git silently drops < and > from an identity (and keeps spaces in an email), so the commit would differ from the config.
  name: text(MAX_CONFIG_NAME).regex(/^[^<>]*$/, '< and > are not allowed').optional(),
  email: text(MAX_CONFIG_NAME).regex(/^[^\s<>]*$/, 'Spaces, < and > are not allowed').optional(),
  signingKey: text(MAX_CONFIG_SIGNING_KEY).optional(),
  gpgSign: z.enum(['', 'true', 'false']).optional(),
  gpgFormat: z.enum(['', ...GPG_FORMATS]).optional()
})
export type GitConfigWrite = z.input<typeof gitConfigWriteSchema>

/** Values as git stores them; null = not set. `gpgSign` is normalized to 'true'/'false' when git would parse it as a bool. */
export type GitConfigValues = Record<GitConfigField, string | null>

/**
 * Where an effective value comes from: `project` = the repo's own (common) .git/config, what `--local` writes;
 * `worktree` = config.worktree (extensions.worktreeConfig), shown but not edited; `command` = `-c`/env.
 */
export type GitConfigSource = 'project' | 'worktree' | 'profile' | 'global' | 'system' | 'command' | 'none'

export interface GitConfigEffective {
  value: string | null
  source: GitConfigSource
  /** The repo's own value (`--local`), even when something else wins (null when none). */
  project: string | null
  /** The last value a known profile file contributes to this repo's config, even when something else wins. */
  profile: { file: string; value: string } | null
}

/** A git config profile's name (Settings > Git > Profiles): shown only, never part of a path. */
export const MAX_PROFILE_NAME = 64
export const gitProfileNameSchema = text(MAX_PROFILE_NAME).min(1, 'Enter a profile name')

export interface GitProfile {
  /** mendel-generated UUID; the profile file is `<id>.gitconfig`. */
  id: string
  name: string
  values: GitConfigValues
  /** How many repositories it is assigned to. */
  repos: number
}

/** Settings > Git > This repository: the assigned profile and each field's effective value. */
export interface RepoGitConfig {
  profile: { id: string; name: string } | null
  fields: Record<GitConfigField, { value: string | null; source: GitConfigSource; project: string | null; inProfile: boolean }>
  /** Fields the profile defines but a later definition in the user's global file overrides (the include line comes first). */
  trap: GitConfigField[]
  /** The assigned profile sets values, yet git reads none of them in this repository (assign again to repair). */
  notApplied: boolean
}
