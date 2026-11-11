import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectiveConfig, globalConfigFile, readConfig, writeConfig, type ConfigScope } from '../../src/main/git/config'
import { gitConfigWriteSchema, MAX_CONFIG_NAME, MAX_CONFIG_SIGNING_KEY } from '../../src/shared/gitConfig'
import { isolatedGitEnv } from '../fixtures/git-env'

const NONE = { name: null, email: null, signingKey: null, gpgSign: null, gpgFormat: null }
// What isolatedGitEnv writes to the temp global config.
const GLOBAL = { name: 'Test User', email: 'test@example.com', signingKey: null, gpgSign: 'false', gpgFormat: null }

describe('git config per scope', () => {
  let dir: string
  let env: NodeJS.ProcessEnv
  let repo: string
  const sh = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim()

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mendel-config-')))
    env = isolatedGitEnv(dir)
    // Guard: every --global read/write below must land in the temp dir, never in the machine's ~/.gitconfig.
    const origin = sh(['config', '--global', '--show-origin', '--get', 'user.name'], dir)
    const file = realpathSync.native(origin.slice('file:'.length, origin.indexOf('\t')))
    if (!file.startsWith(dir + path.sep)) throw new Error(`Global git config is not isolated (${file}); refusing to run`)
    repo = path.join(dir, 'repo')
    sh(['init', '-q', repo], dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

  // A config file path with spaces and quotes (`"` is not allowed in Windows file names).
  const oddFile = () => path.join(dir, 'pro files', process.platform === 'win32' ? "it's a profile.gitconfig" : `it's "a" profile.gitconfig`)
  const scopes: [string, () => ConfigScope][] = [
    ['global', () => 'global'],
    ['local', () => 'local'],
    ['file', () => ({ file: oddFile() })]
  ]

  it.each(scopes)('%s: set, read, unset (empty field), unset of an absent key', async (_, scope) => {
    mkdirSync(path.join(dir, 'pro files'))
    const s = scope()
    const all = { name: 'A B', email: 'a@b.c', signingKey: 'ABCD1234', gpgSign: 'true', gpgFormat: 'ssh' } as const
    await writeConfig(s, repo, all, env)
    expect(await readConfig(s, repo, env)).toEqual(all)
    await writeConfig(s, repo, { name: '', signingKey: '', gpgFormat: '' }, env)
    expect(await readConfig(s, repo, env)).toEqual({ ...all, name: null, signingKey: null, gpgFormat: null })
    await writeConfig(s, repo, { name: '' }, env) // already absent: not an error
    // The terminal sees the same file.
    const where = s === 'global' ? ['--global'] : s === 'local' ? ['--local'] : ['--file', oddFile()]
    expect(sh(['config', ...where, '--get', 'user.email'])).toBe('a@b.c')
  }, 20_000)

  it('reads an unset scope as nulls; normalizes git booleans; ignores keys outside the allow-list', async () => {
    expect(await readConfig('local', repo, env)).toEqual(NONE)
    expect(await readConfig({ file: path.join(dir, 'missing.gitconfig') }, repo, env)).toEqual(NONE)
    sh(['config', 'commit.gpgsign', 'yes'])
    sh(['config', 'user.nameX', 'no'])
    expect(await readConfig('local', repo, env)).toEqual({ ...NONE, gpgSign: 'true' })
    expect(await readConfig('global', repo, env)).toEqual(GLOBAL)
    sh(['config', 'commit.gpgsign', '0k']) // git int with unit suffix
    sh(['config', 'user.signingkey', 'a\nb']) // hand-written multi-line value
    expect(await readConfig('local', repo, env)).toEqual({ ...NONE, gpgSign: 'false', signingKey: 'a\nb' })
    expect((await effectiveConfig(repo, [], env)).signingKey).toMatchObject({ value: 'a\nb', source: 'project' })
  })

  it('writes odd values verbatim (spaces, quotes, #, ;, backslashes, non-ASCII, leading -), trimmed', async () => {
    const name = `-n --global "Q" it's #hash ;semi \\back\\slash Ünïcødé 名前`
    const signingKey = 'key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI+/x= me@host'
    await writeConfig('local', repo, { name: `  ${name}  `, email: '--version', signingKey }, env)
    expect(await readConfig('local', repo, env)).toEqual({ ...NONE, name, email: '--version', signingKey })
    expect(sh(['config', '--local', '--get', 'user.name'])).toBe(name)
    expect(await readConfig('global', repo, env)).toEqual(GLOBAL) // no option leaked into another scope
  })

  it('an invalid field writes nothing', async () => {
    const bad: unknown[] = [
      { name: 'ok', email: 'a\nb' },
      { name: 'ok', email: 'a\0b' },
      { name: 'ok', email: 'tab\there' },
      { name: 'ok', email: 'esc\x1b' },
      { name: 'ok', email: 'x'.repeat(MAX_CONFIG_NAME + 1) },
      { name: 'ok', gpgSign: 'yes' },
      { name: 'ok', gpgFormat: 'gpg' },
      { name: 'ok', 'core.sshCommand': 'x' },
      { name: 'ok', email: '-' } // passes the schema, refused by endOfOptions before the first write
    ]
    for (const v of bad) await expect(writeConfig('local', repo, v as never, env)).rejects.toThrow()
    expect(await readConfig('local', repo, env)).toEqual(NONE)
  })

  it('effective value: only global', async () => {
    const e = await effectiveConfig(repo, [], env)
    expect(e.name).toEqual({ value: 'Test User', source: 'global', project: null, profile: null })
    expect(e.gpgSign).toEqual({ value: 'false', source: 'global', project: null, profile: null })
    expect(e.signingKey).toEqual({ value: null, source: 'none', project: null, profile: null })
  })

  it('effective value: a project value beats global', async () => {
    await writeConfig('local', repo, { email: 'p@x' }, env)
    const e = await effectiveConfig(repo, [], env)
    expect(e.email).toEqual({ value: 'p@x', source: 'project', project: 'p@x', profile: null })
    expect(e.name.source).toBe('global')
  })

  // The design's assignment: a profile file, an assignments file with includeIf gitdir sections, one include.path line.
  const cond = process.platform === 'win32' || process.platform === 'darwin' ? 'gitdir/i:' : 'gitdir:'
  const profileFile = () => path.join(dir, 'pro files', process.platform === 'win32' ? 'p 1.gitconfig' : 'p "1".gitconfig')
  const assignments = () => path.join(dir, 'assign ments.gitconfig')
  const gitDirOf = (r: string) => realpathSync.native(sh(['rev-parse', '--path-format=absolute', '--git-common-dir'], r)).split(path.sep).join('/')
  async function writeProfile() {
    mkdirSync(path.join(dir, 'pro files'))
    await writeConfig({ file: profileFile() }, repo, { email: 'prof@x', signingKey: 'PROFKEY', gpgSign: 'true' }, env)
  }
  const assign = (suffix: '' | '/') => sh(['config', '--file', assignments(), `includeIf.${cond}${gitDirOf(repo)}${suffix}.path`, profileFile()])

  it('effective value with an assigned profile: precedence, worktrees, unrelated repos', async () => {
    await writeProfile()
    sh(['commit', '--allow-empty', '-q', '-m', 'init'])
    const wt = path.join(dir, 'wt')
    sh(['worktree', 'add', '-q', '-b', 'wt', wt])
    sh(['config', '--global', '--add', 'include.path', assignments()]) // after [user]: the profile wins

    // `<gitdir>/` matches linked worktrees only, not the main work tree.
    assign('/')
    expect((await effectiveConfig(repo, [profileFile()], env)).signingKey.source).toBe('none')
    expect((await effectiveConfig(wt, [profileFile()], env)).signingKey).toEqual({ value: 'PROFKEY', source: 'profile', project: null, profile: { file: profileFile(), value: 'PROFKEY' } })
    // `<gitdir>` matches the main work tree.
    assign('')
    let e = await effectiveConfig(repo, [profileFile()], env)
    expect(e.email).toEqual({ value: 'prof@x', source: 'profile', project: null, profile: { file: profileFile(), value: 'prof@x' } })
    expect(e.gpgSign).toMatchObject({ value: 'true', source: 'profile' })
    expect(e.name).toEqual({ value: 'Test User', source: 'global', project: null, profile: null }) // not in the profile
    expect(sh(['config', 'user.signingkey'])).toBe('PROFKEY') // the terminal agrees

    // A project value beats the profile, and the profile value is still reported.
    sh(['config', 'user.email', 'local@x'])
    e = await effectiveConfig(repo, [profileFile()], env)
    expect(e.email).toEqual({ value: 'local@x', source: 'project', project: 'local@x', profile: { file: profileFile(), value: 'prof@x' } })

    // Without the profile file in the known list, the same value is plain global scope.
    expect((await effectiveConfig(repo, [], env)).signingKey.source).toBe('global')

    const other = path.join(dir, 'other')
    sh(['init', '-q', other], dir)
    e = await effectiveConfig(other, [profileFile()], env)
    expect(e.email).toEqual({ value: 'test@example.com', source: 'global', project: null, profile: null })
    expect(e.signingKey.source).toBe('none')
  }, 30_000)

  it('ordering trap: a global value after the include line beats the profile, reported truthfully', async () => {
    await writeProfile()
    assign('')
    sh(['config', '--global', '--remove-section', 'user'])
    sh(['config', '--global', '--add', 'include.path', assignments()])
    sh(['config', '--global', 'user.email', 'late@x']) // a new [user] section, after the include
    const e = await effectiveConfig(repo, [profileFile()], env)
    expect(e.email).toEqual({ value: 'late@x', source: 'global', project: null, profile: { file: profileFile(), value: 'prof@x' } })
    expect(e.signingKey.source).toBe('profile')
    expect(sh(['config', 'user.email'])).toBe('late@x')
  }, 20_000)
})

describe('git config write schema', () => {
  it('trims, caps and rejects control characters before trimming', () => {
    expect(gitConfigWriteSchema.parse({ name: '  a b  ' })).toEqual({ name: 'a b' })
    expect(gitConfigWriteSchema.parse({ name: 'x'.repeat(MAX_CONFIG_NAME) }).name).toHaveLength(MAX_CONFIG_NAME)
    expect(gitConfigWriteSchema.parse({ signingKey: 'k'.repeat(MAX_CONFIG_SIGNING_KEY) }).signingKey).toHaveLength(MAX_CONFIG_SIGNING_KEY)
    for (const bad of ['a\n', '\nb', 'a\r', 'a\0', '\x7f', '\u0085', 'x'.repeat(MAX_CONFIG_NAME + 1)]) expect(gitConfigWriteSchema.safeParse({ name: bad }).success).toBe(false)
    expect(gitConfigWriteSchema.safeParse({ signingKey: 'k'.repeat(MAX_CONFIG_SIGNING_KEY + 1) }).success).toBe(false)
    for (const bad of [{ name: 'a <b>' }, { email: 'a b@c' }, { email: '<a@b>' }]) expect(gitConfigWriteSchema.safeParse(bad).success).toBe(false)
    expect(gitConfigWriteSchema.parse({ name: '', email: ' a@b ' })).toEqual({ name: '', email: 'a@b' })
    expect(gitConfigWriteSchema.parse({ gpgSign: '', gpgFormat: 'x509' })).toEqual({ gpgSign: '', gpgFormat: 'x509' })
    expect(gitConfigWriteSchema.safeParse({ gpgSign: true }).success).toBe(false)
  })
})

describe('globalConfigFile: the file git itself uses for --global', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

  // Temp HOME and XDG dir only; GIT_CONFIG_GLOBAL dropped so git applies its own ~/.gitconfig vs XDG rule.
  const setup = (files: ('home' | 'xdg')[], xdgHome?: string) => {
    dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'mendel-gcf-')))
    const { GIT_CONFIG_GLOBAL: _, ...env } = isolatedGitEnv(dir)
    rmSync(path.join(dir, 'home', '.gitconfig'))
    if (xdgHome) env.XDG_CONFIG_HOME = xdgHome
    else delete env.XDG_CONFIG_HOME
    const home = path.join(dir, 'home')
    const xdg = path.join(xdgHome ?? path.join(home, '.config'), 'git', 'config')
    if (files.includes('home')) writeFileSync(path.join(home, '.gitconfig'), '')
    if (files.includes('xdg')) (mkdirSync(path.dirname(xdg), { recursive: true }), writeFileSync(xdg, ''))
    return { env, home: path.join(home, '.gitconfig'), xdg }
  }
  /** Where `git config --global` writes, and that globalConfigFile names the same file. */
  const gitWrites = (env: NodeJS.ProcessEnv) => {
    execFileSync('git', ['config', '--global', 'mendel.probe', 'x'], { cwd: dir, env })
    const origin = execFileSync('git', ['config', '--global', '--show-origin', '--get', 'mendel.probe'], { cwd: dir, env, encoding: 'utf8' })
    return origin.slice('file:'.length, origin.indexOf('\t'))
  }

  it('none: null (git would create ~/.gitconfig)', () => {
    const { env, home } = setup([])
    expect(globalConfigFile(env)).toBeNull()
    expect(gitWrites(env)).toBe(home)
  })
  it.each([
    ['only ~/.gitconfig', ['home'] as const, 'home' as const],
    ['only ~/.config/git/config', ['xdg'] as const, 'xdg' as const],
    ['both: ~/.gitconfig wins', ['home', 'xdg'] as const, 'home' as const]
  ])('%s', (_, files, want) => {
    const f = setup([...files])
    expect(globalConfigFile(f.env)).toBe(f[want])
    expect(gitWrites(f.env)).toBe(f[want])
  })
  it('$XDG_CONFIG_HOME', () => {
    const f = setup(['xdg'], path.join(realpathSync.native(tmpdir()), `mendel-gcf-xdg-${process.pid}`))
    try {
      expect(globalConfigFile(f.env)).toBe(f.xdg)
      expect(gitWrites(f.env)).toBe(f.xdg)
    } finally {
      rmSync(path.dirname(path.dirname(f.xdg)), { recursive: true, force: true })
    }
  })
  it('$GIT_CONFIG_GLOBAL wins, null while that file is missing', () => {
    const f = setup(['home', 'xdg'])
    const own = path.join(dir, 'own.gitconfig')
    expect(globalConfigFile({ ...f.env, GIT_CONFIG_GLOBAL: own })).toBeNull()
    writeFileSync(own, '')
    expect(globalConfigFile({ ...f.env, GIT_CONFIG_GLOBAL: own })).toBe(own)
    expect(gitWrites({ ...f.env, GIT_CONFIG_GLOBAL: own })).toBe(own)
    expect(existsSync(f.home)).toBe(true)
  })
})
