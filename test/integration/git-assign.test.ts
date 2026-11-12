import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeConfig } from '../../src/main/git/config'
import { assignmentsFile, assignProfile, createProfile, deleteProfile, followMovedRepo, listProfiles, parseIndex, profileFile, profileUsage, repoGitConfig } from '../../src/main/gitProfiles'
import log from '../../src/main/log'
import { globalOrigin, isolatedGitEnv } from '../fixtures/git-env'

const A = '0b7c3c1e-6a4f-4f3e-9f53-1b2a3c4d5e6f'
const COND = process.platform === 'win32' || process.platform === 'darwin' ? 'gitdir/i:' : 'gitdir:'

describe('git profile assignment index parsing', () => {
  it('keeps valid assignments of listed profiles, first per git dir; never checks that the path exists', () => {
    const missing = path.resolve('/nowhere/at/all/.git')
    expect(
      parseIndex({
        profiles: [{ id: A, name: 'Work' }],
        assignments: [
          { gitDir: missing, repoId: 'r1', profileId: A },
          { gitDir: missing, repoId: 'r2', profileId: A },
          { gitDir: 'relative/.git', repoId: 'r3', profileId: A },
          { gitDir: path.resolve('/x/.git'), repoId: 'r4', profileId: '1c8d4d2f-7b5a-4a4f-8a64-2c3b4d5e6f70' },
          { gitDir: path.resolve('/y/.git'), repoId: '', profileId: A },
          'junk'
        ]
      }).assignments
    ).toEqual([{ gitDir: missing, repoId: 'r1', profileId: A }])
  })
})

describe('git profile assignment', () => {
  let tmp: string
  let dir: string
  let env: NodeJS.ProcessEnv
  let globalFile: string
  const sh = (args: string[], cwd = tmp) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim()
  const repo = (name: string) => {
    const r = path.join(tmp, name)
    sh(['init', '-q', r])
    return r
  }
  /** The repository's git dir as the index stores it (native), and as the include pattern has it (forward slashes). */
  const nativeGitDir = (r: string) => realpathSync.native(path.join(r, '.git'))
  const gitDir = (r: string) => nativeGitDir(r).replace(/\\/g, '/')
  const includes = () => {
    try {
      return sh(['config', '--global', '--get-all', 'include.path']).split('\n')
    } catch {
      return [] // exit 1: none
    }
  }
  const email = (cwd: string) => sh(['config', 'user.email'], cwd)
  const index = () => JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8')) as { assignments: { gitDir: string; repoId: string; profileId: string }[] }
  // The generated file as git reads it back: [key, value] per line.
  const generated = () => sh(['config', '--file', assignmentsFile(dir), '--list']).split('\n')
  const sections = (r: string, id: string) => [`includeif.${COND}${gitDir(r)}.path=${profileFile(dir, id)}`, `includeif.${COND}${gitDir(r)}/worktrees/.path=${profileFile(dir, id)}`]

  beforeEach(() => {
    tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mendel-assign-')))
    env = isolatedGitEnv(tmp)
    // Guard: every --global read/write below must land in the temp dir, never in the machine's ~/.gitconfig.
    globalFile = realpathSync.native(globalOrigin(env, 'user.name', tmp))
    if (!globalFile.startsWith(tmp + path.sep)) throw new Error(`Global git config is not isolated (${globalFile}); refusing to run`)
    dir = path.join(tmp, 'git-profiles')
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }))

  it('0, 1 and 2 assignments: generated file and one global line; the user’s own include.path survives', async () => {
    const user = path.join(tmp, 'mine.gitconfig')
    sh(['config', '--global', '--add', 'include.path', user])
    const a = repo('a')
    const b = repo('b')
    const work = await createProfile(dir, 'Work', { email: 'w@example.com' }, env)
    expect(existsSync(assignmentsFile(dir))).toBe(false)
    expect(includes()).toEqual([user])

    await assignProfile(dir, 'ra', a, work.id, env)
    expect(generated()).toEqual(sections(a, work.id))
    expect(includes()).toEqual([user, assignmentsFile(dir)])
    const raw = profileFile(dir, work.id).replaceAll('\\', '\\\\')
    expect(readFileSync(assignmentsFile(dir), 'utf8')).toBe(
      // git escapes the backslashes of a Windows path in the file
      `[includeIf "${COND}${gitDir(a)}"]\n\tpath = ${raw}\n[includeIf "${COND}${gitDir(a)}/worktrees/"]\n\tpath = ${raw}\n`
    )

    await assignProfile(dir, 'rb', b, work.id, env)
    expect(generated()).toEqual([...sections(a, work.id), ...sections(b, work.id)])
    expect(includes()).toEqual([user, assignmentsFile(dir)]) // once
    expect((await listProfiles(dir, env))[0]!.repos).toBe(2)
    expect(profileUsage(dir, work.id)).toEqual({ name: 'Work', repos: 2 })

    await assignProfile(dir, 'ra', a, null, env)
    expect(generated()).toEqual(sections(b, work.id))
    expect(includes()).toEqual([user, assignmentsFile(dir)])
    await assignProfile(dir, 'rb', b, null, env)
    expect(existsSync(assignmentsFile(dir))).toBe(false)
    expect(includes()).toEqual([user])
    await assignProfile(dir, 'rb', b, null, env) // nothing assigned: no-op
    expect(includes()).toEqual([user])
    expect(index().assignments).toEqual([])
    expect(readFileSync(globalFile, 'utf8')).toContain('name = Test User') // the rest of the global file is untouched
  }, 30_000)

  it('applies to the repository and its linked worktree only; re-assign and unassign; sources and values', async () => {
    const a = repo('a')
    const b = repo('b')
    sh(['commit', '-q', '--allow-empty', '-m', 'x'], a)
    const wt = path.join(tmp, 'a-wt')
    sh(['worktree', 'add', '-q', wt], a)
    const work = await createProfile(dir, 'Work', { name: 'Work Person', email: 'w@example.com' }, env)
    const home = await createProfile(dir, 'Home', { email: 'h@example.com' }, env)

    await assignProfile(dir, 'ra', a, work.id, env)
    expect([email(a), email(wt), email(b)]).toEqual(['w@example.com', 'w@example.com', 'test@example.com'])
    const st = await repoGitConfig(dir, 'ra', a, env)
    expect(st.profile).toEqual({ id: work.id, name: 'Work' })
    expect(st.fields.email).toEqual({ value: 'w@example.com', source: 'profile', project: null, inProfile: true })
    expect(st.fields.gpgSign).toEqual({ value: 'false', source: 'global', project: null, inProfile: false })
    expect(st.fields.signingKey).toEqual({ value: null, source: 'none', project: null, inProfile: false })
    expect(st.trap).toEqual([])
    // The worktree (its own repo id) shows the same assignment.
    expect((await repoGitConfig(dir, 'rwt', wt, env)).profile).toEqual({ id: work.id, name: 'Work' })
    expect((await repoGitConfig(dir, 'rb', b, env)).profile).toBeNull()

    // A project value overrides the profile.
    sh(['config', 'user.email', 'p@example.com'], a)
    expect((await repoGitConfig(dir, 'ra', a, env)).fields.email).toEqual({ value: 'p@example.com', source: 'project', project: 'p@example.com', inProfile: true })
    sh(['config', '--unset', 'user.email'], a)

    // Re-assign from the worktree: one assignment per repository, replaced.
    await assignProfile(dir, 'rwt', wt, home.id, env)
    expect(index().assignments).toEqual([{ gitDir: nativeGitDir(a), repoId: 'rwt', profileId: home.id }])
    expect([email(a), email(wt), sh(['config', 'user.name'], a)]).toEqual(['h@example.com', 'h@example.com', 'Test User'])
    expect((await repoGitConfig(dir, 'ra', a, env)).fields.name).toEqual({ value: 'Test User', source: 'global', project: null, inProfile: false })

    await assignProfile(dir, 'ra', a, null, env)
    expect([email(a), email(wt)]).toEqual(['test@example.com', 'test@example.com'])
    const after = await repoGitConfig(dir, 'ra', a, env)
    expect(after.profile).toBeNull()
    expect(after.fields.email).toEqual({ value: 'test@example.com', source: 'global', project: null, inProfile: false })
  }, 30_000)

  it('a repository path with spaces, quotes and glob characters matches only itself', async () => {
    // Windows file names cannot hold `"` or `*`: the bracket class is the glob there
    const odd = repo(process.platform === 'win32' ? "it's [x] y" : `it's "q" [x] *`)
    const near = repo(process.platform === 'win32' ? "it's x y" : `it's "q" x y`) // what [x] * would match unescaped
    const work = await createProfile(dir, 'Work', { email: 'w@example.com' }, env)
    await assignProfile(dir, 'odd', odd, work.id, env)
    expect([email(odd), email(near)]).toEqual(['w@example.com', 'test@example.com'])
    expect((await repoGitConfig(dir, 'odd', odd, env)).fields.email.source).toBe('profile')
  }, 30_000)

  it('deleting an assigned profile unassigns its repositories and removes the global line', async () => {
    const a = repo('a')
    const b = repo('b')
    const work = await createProfile(dir, 'Work', { email: 'w@example.com' }, env)
    const home = await createProfile(dir, 'Home', { email: 'h@example.com' }, env)
    await assignProfile(dir, 'ra', a, work.id, env)
    await assignProfile(dir, 'rb', b, home.id, env)
    await deleteProfile(dir, work.id, env)
    expect([email(a), email(b)]).toEqual(['test@example.com', 'h@example.com'])
    expect(generated()).toEqual(sections(b, home.id))
    expect(includes()).toEqual([assignmentsFile(dir)])
    await deleteProfile(dir, home.id, env)
    expect(existsSync(assignmentsFile(dir))).toBe(false)
    expect(includes()).toEqual([])
    expect(index().assignments).toEqual([])
  }, 30_000)

  it('a moved repository keeps its assignment; one whose path is gone is never dropped', async () => {
    const a = repo('a')
    const gone = repo('gone')
    const work = await createProfile(dir, 'Work', { email: 'w@example.com' }, env)
    await assignProfile(dir, 'ra', a, work.id, env)
    await assignProfile(dir, 'rg', gone, work.id, env)
    const goneDir = gitDir(gone)
    const goneNative = nativeGitDir(gone)
    rmSync(gone, { recursive: true })
    const moved = path.join(tmp, 'moved')
    renameSync(a, moved)
    expect(email(moved)).toBe('test@example.com') // git no longer matches the old path
    expect((await repoGitConfig(dir, 'ra', moved, env)).profile).toEqual({ id: work.id, name: 'Work' })
    expect(email(moved)).toBe('w@example.com')
    expect(index().assignments).toEqual([
      { gitDir: nativeGitDir(moved), repoId: 'ra', profileId: work.id },
      { gitDir: goneNative, repoId: 'rg', profileId: work.id }
    ])
    expect(generated()).toEqual([...sections(moved, work.id), `includeif.${COND}${goneDir}.path=${profileFile(dir, work.id)}`, `includeif.${COND}${goneDir}/worktrees/.path=${profileFile(dir, work.id)}`])
  }, 30_000)

  it('opening a moved repository re-points its assignment without the settings card; no assignment: no git, no write', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    try {
      const notRepo = path.join(tmp, 'not-a-repo')
      await followMovedRepo(dir, 'ra', notRepo, env) // git here would fail and log
      expect([existsSync(dir), warn.mock.calls.length]).toEqual([false, 0])

      const a = repo('a')
      const b = repo('b')
      const c = repo('c')
      const work = await createProfile(dir, 'Work', { email: 'w@example.com' }, env)
      await assignProfile(dir, 'ra', a, work.id, env)
      await assignProfile(dir, 'rb', b, work.id, env)
      const before = readFileSync(path.join(dir, 'index.json'), 'utf8')
      await followMovedRepo(dir, 'rc', c, env) // no assignment under its id: nothing created
      await followMovedRepo(dir, 'ra', b, env) // b's git dir has its own assignment: never re-pointed
      await followMovedRepo(dir, 'rb', b, env) // not moved
      expect(readFileSync(path.join(dir, 'index.json'), 'utf8')).toBe(before)
      expect(warn).not.toHaveBeenCalled()

      const moved = path.join(tmp, 'moved')
      renameSync(a, moved)
      expect(email(moved)).toBe('test@example.com')
      await followMovedRepo(dir, 'ra', moved, env)
      expect(email(moved)).toBe('w@example.com')
      expect(email(b)).toBe('w@example.com')
      expect(email(c)).toBe('test@example.com')
      expect(index().assignments).toEqual([
        { gitDir: nativeGitDir(moved), repoId: 'ra', profileId: work.id },
        { gitDir: nativeGitDir(b), repoId: 'rb', profileId: work.id }
      ])
      expect(generated()).toEqual([...sections(moved, work.id), ...sections(b, work.id)])

      // A failure (git cannot run there) is logged, never thrown, and changes nothing.
      const after = readFileSync(path.join(dir, 'index.json'), 'utf8')
      await expect(followMovedRepo(dir, 'ra', path.join(tmp, 'gone'), env)).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(readFileSync(path.join(dir, 'index.json'), 'utf8')).toBe(after)
    } finally {
      warn.mockRestore()
    }
  }, 30_000)

  it('reports the ordering trap: a global definition after the include line wins over the profile', async () => {
    const a = repo('a')
    const work = await createProfile(dir, 'Work', { name: 'Work Person', email: 'w@example.com' }, env)
    await assignProfile(dir, 'ra', a, work.id, env)
    appendFileSync(globalFile, '[user]\n\temail = late@example.com\n') // the user's own edit, after mendel's line
    const st = await repoGitConfig(dir, 'ra', a, env)
    expect(st.trap).toEqual(['email'])
    expect(st.fields.email).toEqual({ value: 'late@example.com', source: 'global', project: null, inProfile: true })
    expect(st.fields.name.source).toBe('profile')
  }, 30_000)

  it('a submodule does not take its superproject’s profile; a worktree added after assigning does', async () => {
    const sup = repo('sup')
    const src = repo('src')
    sh(['commit', '-q', '--allow-empty', '-m', 'x'], src)
    sh(['commit', '-q', '--allow-empty', '-m', 'x'], sup)
    sh(['-c', 'protocol.file.allow=always', 'submodule', '-q', 'add', src, 'sub'], sup)
    const work = await createProfile(dir, 'Work', { email: 'w@example.com' }, env)
    await assignProfile(dir, 'sup', sup, work.id, env)
    const wt = path.join(tmp, 'late-wt')
    sh(['worktree', 'add', '-q', wt], sup)
    expect([email(sup), email(wt), email(path.join(sup, 'sub'))]).toEqual(['w@example.com', 'w@example.com', 'test@example.com'])
  }, 30_000)

  it('profile files under a symlinked path with a space still read as the profile (include.path string = git origin)', async () => {
    mkdirSync(path.join(tmp, 'real', 'Application Support'), { recursive: true })
    symlinkSync(path.join(tmp, 'real'), path.join(tmp, 'link'), 'junction') // junction: a directory link Windows allows without privileges; ignored elsewhere
    dir = path.join(tmp, 'link', 'Application Support', 'git-profiles')
    const a = repo('a')
    const work = await createProfile(dir, 'Work', { email: 'w@example.com' }, env)
    await assignProfile(dir, 'ra', a, work.id, env)
    const st = await repoGitConfig(dir, 'ra', a, env)
    expect([st.fields.email.source, st.notApplied]).toEqual(['profile', false])
  }, 30_000)

  it('a removed include line or a failed global write shows as not applied; assigning again repairs it', async () => {
    const a = repo('a')
    const work = await createProfile(dir, 'Work', { email: 'w@example.com' }, env)
    await assignProfile(dir, 'ra', a, work.id, env)
    sh(['config', '--global', '--unset', 'include.path']) // the user removes mendel's line by hand
    expect(email(a)).toBe('test@example.com')
    let st = await repoGitConfig(dir, 'ra', a, env)
    expect([st.profile?.name, st.notApplied, st.fields.email.source]).toEqual(['Work', true, 'global'])
    await assignProfile(dir, 'ra', a, work.id, env)
    expect([email(a), includes()]).toEqual(['w@example.com', [assignmentsFile(dir)]])
    expect((await repoGitConfig(dir, 'ra', a, env)).notApplied).toBe(false)

    await assignProfile(dir, 'ra', a, null, env)
    const broken = { ...env, GIT_CONFIG_GLOBAL: path.join(tmp, 'missing-dir', '.gitconfig') } // git cannot lock it
    await expect(assignProfile(dir, 'ra', a, work.id, broken)).rejects.toThrow()
    st = await repoGitConfig(dir, 'ra', a, env)
    expect([st.profile?.name, st.notApplied]).toEqual(['Work', true])
    await assignProfile(dir, 'ra', a, work.id, env)
    expect((await repoGitConfig(dir, 'ra', a, env)).notApplied).toBe(false)
  }, 30_000)

  it.skipIf(process.platform === 'win32')('a repository path with a control character is refused before anything is written', async () => {
    const r = repo('tab\there')
    const work = await createProfile(dir, 'Work', { email: 'w@example.com' }, env)
    await expect(assignProfile(dir, 'rt', r, work.id, env)).rejects.toThrow('control characters')
    expect(index().assignments).toEqual([])
    expect([existsSync(assignmentsFile(dir)), includes()]).toEqual([false, []])
  }, 30_000)

  it('assignments started together never drop one another', async () => {
    const rs = ['a', 'b', 'c', 'd'].map(repo)
    const work = await createProfile(dir, 'Work', { email: 'w@example.com' }, env)
    await Promise.all(rs.map((r, i) => assignProfile(dir, `r${i}`, r, work.id, env)))
    expect(index().assignments.map((x) => x.repoId).sort()).toEqual(['r0', 'r1', 'r2', 'r3'])
    expect(rs.map(email)).toEqual(rs.map(() => 'w@example.com'))
    expect(includes()).toEqual([assignmentsFile(dir)])
    await Promise.all(rs.map((r, i) => assignProfile(dir, `r${i}`, r, null, env)))
    expect(existsSync(assignmentsFile(dir))).toBe(false)
    expect(includes()).toEqual([])
  }, 30_000)

  // settings:setRepoGitConfig = writeConfig('local', <repo root>, values).
  it('project values: set, change, remove; project > profile > global; a worktree shares them; .git/config gains only those keys', async () => {
    const a = repo('a')
    sh(['commit', '-q', '--allow-empty', '-m', 'x'], a)
    sh(['remote', 'add', 'origin', 'https://example.com/a.git'], a)
    sh(['config', 'branch.main.remote', 'origin'], a)
    const wt = path.join(tmp, 'a-wt')
    sh(['worktree', 'add', '-q', wt], a)
    const local = path.join(a, '.git', 'config')
    const before = readFileSync(local, 'utf8')
    const work = await createProfile(dir, 'Work', { name: 'Work Person', email: 'w@example.com' }, env)
    await assignProfile(dir, 'ra', a, work.id, env)
    const field = async (cwd: string, id: string) => (await repoGitConfig(dir, id, cwd, env)).fields

    // Set from the worktree: --local writes the shared config, so both work trees see it.
    await writeConfig('local', wt, { email: 'p@example.com', signingKey: 'KEY1', gpgSign: 'true' }, env)
    expect([email(a), email(wt)]).toEqual(['p@example.com', 'p@example.com'])
    for (const [cwd, id] of [[a, 'ra'], [wt, 'rwt']]) {
      const f = await field(cwd, id)
      expect(f.email).toEqual({ value: 'p@example.com', source: 'project', project: 'p@example.com', inProfile: true }) // beats profile
      expect(f.gpgSign).toEqual({ value: 'true', source: 'project', project: 'true', inProfile: false }) // beats global
      expect(f.signingKey).toEqual({ value: 'KEY1', source: 'project', project: 'KEY1', inProfile: false }) // beats nothing set
      expect(f.name).toEqual({ value: 'Work Person', source: 'profile', project: null, inProfile: true })
    }
    // Change; an absent field is untouched.
    await writeConfig('local', a, { email: 'q@example.com' }, env)
    expect([email(wt), sh(['config', 'user.signingkey'], a)]).toEqual(['q@example.com', 'KEY1'])

    // Removing restores the profile's value, or the global one.
    await writeConfig('local', a, { email: '', gpgSign: '', signingKey: '' }, env)
    const f = await field(a, 'ra')
    expect(f.email).toEqual({ value: 'w@example.com', source: 'profile', project: null, inProfile: true })
    expect(f.gpgSign).toEqual({ value: 'false', source: 'global', project: null, inProfile: false })
    expect(f.signingKey).toEqual({ value: null, source: 'none', project: null, inProfile: false })
    // Removed cleanly: the rest of .git/config (core, remote, branch) is byte for byte as before; git keeps empty section headers.
    const strip = (t: string) => t.replace(/^\[(user|commit)\]\n/gm, '')
    expect(strip(readFileSync(local, 'utf8'))).toBe(before)

    // Unassigned: a project value beats global and removing it restores global.
    await assignProfile(dir, 'ra', a, null, env)
    const list = () => sh(['config', '--local', '--list'], a).split('\n')
    const keys = list()
    await writeConfig('local', a, { name: 'Proj' }, env)
    expect((await field(a, 'ra')).name).toEqual({ value: 'Proj', source: 'project', project: 'Proj', inProfile: false })
    expect(list()).toEqual([...keys, 'user.name=Proj'])
    await writeConfig('local', a, { name: '' }, env)
    expect((await field(a, 'ra')).name).toEqual({ value: 'Test User', source: 'global', project: null, inProfile: false })
    // Only allow-listed keys can be written.
    await expect(writeConfig('local', a, { core: 'x' } as never, env)).rejects.toThrow()
    expect(readFileSync(globalFile, 'utf8')).not.toContain('Proj')
  }, 30_000)

  it('project values hiding every profile field are not reported as "profile not applied"', async () => {
    const a = repo('a')
    const work = await createProfile(dir, 'Work', { name: 'Work Person', email: 'w@example.com' }, env)
    await assignProfile(dir, 'ra', a, work.id, env)
    await writeConfig('local', a, { name: 'P', email: 'p@example.com' }, env)
    let st = await repoGitConfig(dir, 'ra', a, env)
    expect([st.fields.name.source, st.fields.email.source, st.notApplied, st.trap]).toEqual(['project', 'project', false, []])
    // Still caught when the include line really is gone, project values or not.
    sh(['config', '--global', '--unset', 'include.path'])
    st = await repoGitConfig(dir, 'ra', a, env)
    expect(st.notApplied).toBe(true)
  }, 30_000)

  it('project values: a config.worktree value shows as worktree, not project; duplicates are replaced and removed together; a failed write rejects', async () => {
    const a = repo('a')
    sh(['commit', '-q', '--allow-empty', '-m', 'x'], a)
    const wt = path.join(tmp, 'a-wt')
    sh(['worktree', 'add', '-q', wt], a)
    sh(['config', 'extensions.worktreeConfig', 'true'], a)
    sh(['config', '--worktree', 'user.email', 'wt@example.com'], wt)
    const field = async (cwd: string, id: string) => (await repoGitConfig(dir, id, cwd, env)).fields.email
    // Only --local values are project values (what the dialog edits and Remove unsets).
    expect(await field(wt, 'rwt')).toEqual({ value: 'wt@example.com', source: 'worktree', project: null, inProfile: false })
    await writeConfig('local', wt, { email: 'p@example.com' }, env)
    expect(await field(wt, 'rwt')).toEqual({ value: 'wt@example.com', source: 'worktree', project: 'p@example.com', inProfile: false })
    expect(await field(a, 'ra')).toEqual({ value: 'p@example.com', source: 'project', project: 'p@example.com', inProfile: false })
    await writeConfig('local', wt, { email: '' }, env)
    expect(await field(wt, 'rwt')).toEqual({ value: 'wt@example.com', source: 'worktree', project: null, inProfile: false })
    expect(sh(['config', '--worktree', 'user.email'], wt)).toBe('wt@example.com') // never touched

    // user.email twice in .git/config: the last one shows; a write replaces both, a removal removes both.
    sh(['config', '--add', 'user.email', 'one@example.com'], a)
    sh(['config', '--add', 'user.email', 'two@example.com'], a)
    expect((await field(a, 'ra')).project).toBe('two@example.com')
    await writeConfig('local', a, { email: 'three@example.com' }, env)
    expect(sh(['config', '--local', '--get-all', 'user.email'], a)).toBe('three@example.com')
    sh(['config', '--add', 'user.email', 'four@example.com'], a)
    await writeConfig('local', a, { email: '' }, env)
    expect(await field(a, 'ra')).toEqual({ value: 'test@example.com', source: 'global', project: null, inProfile: false })

    // git cannot write .git/config (no lock file in a read-only .git): the write rejects, nothing changes.
    const gd = path.join(a, '.git')
    chmodSync(gd, 0o555)
    try {
      if (process.platform !== 'win32') await expect(writeConfig('local', a, { email: 'x@example.com' }, env)).rejects.toThrow(/lock/)
    } finally {
      chmodSync(gd, 0o755)
    }
    expect((await field(a, 'ra')).project).toBe(null)
  }, 30_000)
})
