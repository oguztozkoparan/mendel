import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProfile, deleteProfile, listProfiles, parseIndex, profileFile, updateProfile } from '../../src/main/gitProfiles'
import { isolatedGitEnv } from '../fixtures/git-env'

const NONE = { name: null, email: null, signingKey: null, gpgSign: null, gpgFormat: null }
const A = '0b7c3c1e-6a4f-4f3e-9f53-1b2a3c4d5e6f'
const B = '1c8d4d2f-7b5a-4a4f-8a64-2c3b4d5e6f70'

describe('git profile index parsing', () => {
  it('missing or garbage -> empty; bad entries, non-UUID ids and duplicates are dropped one by one', () => {
    expect(parseIndex(undefined).profiles).toEqual([])
    expect(parseIndex({ profiles: 'x' }).profiles).toEqual([])
    expect(
      parseIndex({
        profiles: [
          { id: A, name: ' Work ', extra: 1 },
          { id: '../../etc/passwd', name: 'Evil' },
          { id: B, name: 'work' },
          { id: A, name: 'Other' },
          { id: B, name: 'Personal' },
          { id: B, name: '' }
        ]
      }).profiles
    ).toEqual([
      { id: A, name: 'Work' },
      { id: B, name: 'Personal' }
    ])
  })
  it('a profile file name is built only from a UUID', () => {
    expect(profileFile('/d', A)).toBe(path.join('/d', `${A}.gitconfig`))
    expect(() => profileFile('/d', '../x')).toThrow()
  })
})

describe('git profile store', () => {
  let tmp: string
  let dir: string
  let env: NodeJS.ProcessEnv
  const list = (file: string) => execFileSync('git', ['config', '--file', file, '--list'], { env, encoding: 'utf8' }).trim().split('\n').filter(Boolean)

  beforeEach(() => {
    tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mendel-profiles-')))
    env = isolatedGitEnv(tmp)
    dir = path.join(tmp, 'git-profiles')
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }))

  it('create, list, update (rename + unset), delete', async () => {
    const work = await createProfile(dir, ' Work ', { name: 'W "q" \\ x', email: 'w@example.com', signingKey: 'ABC', gpgSign: 'true', gpgFormat: 'ssh', }, env)
    const empty = await createProfile(dir, 'Empty', {}, env)
    expect(list(profileFile(dir, work.id)).sort()).toEqual(['commit.gpgsign=true', 'gpg.format=ssh', 'user.email=w@example.com', 'user.name=W "q" \\ x', 'user.signingkey=ABC'])
    expect(readFileSync(profileFile(dir, empty.id), 'utf8')).toBe('')
    expect(await listProfiles(dir, env)).toEqual([
      { id: work.id, name: 'Work', values: { name: 'W "q" \\ x', email: 'w@example.com', signingKey: 'ABC', gpgSign: 'true', gpgFormat: 'ssh' }, repos: 0 },
      { id: empty.id, name: 'Empty', values: NONE, repos: 0 }
    ])

    await expect(createProfile(dir, 'WORK', {}, env)).rejects.toThrow('A profile named "Work" already exists')
    await expect(updateProfile(dir, empty.id, 'work', {}, env)).rejects.toThrow('already exists')
    await expect(createProfile(dir, 'x'.repeat(65), {}, env)).rejects.toThrow()
    await expect(createProfile(dir, 'a\nb', {}, env)).rejects.toThrow()
    await expect(createProfile(dir, 'Bad', { email: 'a b' }, env)).rejects.toThrow()
    expect(readdirSync(dir).sort()).toEqual([`${empty.id}.gitconfig`, `${work.id}.gitconfig`, 'index.json'].sort())

    await updateProfile(dir, work.id, 'work', { signingKey: '' }, env) // own name, other case: allowed
    expect((await listProfiles(dir, env))[0]).toEqual({ id: work.id, name: 'work', values: { name: 'W "q" \\ x', email: 'w@example.com', signingKey: null, gpgSign: 'true', gpgFormat: 'ssh' }, repos: 0 })
    await expect(updateProfile(dir, B, 'Nope', {}, env)).rejects.toThrow('Profile not found')

    await deleteProfile(dir, work.id, env)
    expect(existsSync(profileFile(dir, work.id))).toBe(false)
    expect(JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'))).toEqual({ profiles: [{ id: empty.id, name: 'Empty' }], assignments: [] })
  })

  it('a corrupt or missing index never deletes profile files; the corrupt one is kept aside', async () => {
    mkdirSync(dir)
    writeFileSync(path.join(dir, `${A}.gitconfig`), '[user]\n\tname = Kept\n')
    writeFileSync(path.join(dir, 'index.json'), '{not json')
    expect(await listProfiles(dir, env)).toEqual([])
    await createProfile(dir, 'New', {}, env)
    const corrupt = readdirSync(dir).filter((f) => f.startsWith('index.json.corrupt-'))
    expect(corrupt.map((f) => readFileSync(path.join(dir, f), 'utf8'))).toEqual(['{not json'])
    expect(readFileSync(path.join(dir, `${A}.gitconfig`), 'utf8')).toBe('[user]\n\tname = Kept\n')
  })

  it('changes started together never drop one another', async () => {
    const first = await createProfile(dir, 'First', {}, env)
    const [a, b] = await Promise.all([
      createProfile(dir, 'A', { name: 'A' }, env),
      createProfile(dir, 'B', { name: 'B' }, env),
      updateProfile(dir, first.id, 'Renamed', { email: 'r@example.com' }, env)
    ])
    await expect(Promise.all([createProfile(dir, 'Same', {}, env), createProfile(dir, 'same', {}, env)])).rejects.toThrow('already exists')
    expect((await listProfiles(dir, env)).map((p) => p.name)).toEqual(['Renamed', a!.name, b!.name, 'Same'])
    await Promise.all([deleteProfile(dir, a!.id, env), updateProfile(dir, b!.id, 'B2', {}, env)])
    expect((await listProfiles(dir, env)).map((p) => p.name)).toEqual(['Renamed', 'B2', 'Same'])
  })
})
