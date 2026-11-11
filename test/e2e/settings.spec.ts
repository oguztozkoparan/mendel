import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, stubOpenDialog } from './launch'

/** What the page sees; Playwright emulates a light color scheme unless told not to. */
const dark = async (win: import('@playwright/test').Page) => {
  await win.emulateMedia({ colorScheme: null })
  return win.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
}

test('preferences persist across restart and drive the app', async () => {
  const fx = createRepoFixture()
  const userData = path.join(fx.dir, 'userData')
  let app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
  try {
    await openRepo(app, fx.work)
    await app.win.getByRole('button', { name: 'Settings' }).click()
    const dialog = app.win.getByRole('dialog', { name: 'Settings' })
    await dialog.getByText('Dark', { exact: true }).click()
    await expect.poll(() => dark(app.win)).toBe(true)
    await dialog.getByText('Light', { exact: true }).click()
    await expect.poll(() => dark(app.win)).toBe(false)
    await dialog.getByText('Dark', { exact: true }).click()
    await expect(app.win.locator('html')).toHaveAttribute('data-accent', 'cyan')
    await dialog.getByRole('radio', { name: 'Violet' }).click()
    await expect(app.win.locator('html')).toHaveAttribute('data-accent', 'violet')

    await dialog.getByRole('tab', { name: 'Commit' }).click()
    await dialog.getByLabel('Summary soft limit').fill('50')
    await dialog.getByRole('tab', { name: 'Git', exact: true }).click()
    await dialog.getByText('Rebase', { exact: true }).click()
    await expect(dialog.getByLabel('Name (user.name)')).toHaveValue('Test User')
    await dialog.getByLabel('Name (user.name)').fill('New Name')
    await dialog.getByRole('button', { name: 'Save identity' }).click()
    await expect(dialog.getByText('Saved')).toBeVisible()
    expect(execFileSync('git', ['config', '--global', 'user.name'], { env: fx.env, encoding: 'utf8' }).trim()).toBe('New Name')
    await dialog.getByRole('button', { name: 'Done' }).click()

    await expect(app.win.getByRole('form', { name: 'Commit' })).toContainText('50')
    // Pull strategy rebase: a diverged pull rebases (no merge commit).
    const other = path.join(fx.dir, 'other')
    execFileSync('git', ['clone', '-q', fx.remote, other], { env: fx.env })
    writeFileSync(path.join(other, 'r.txt'), 'r\n')
    for (const a of [['add', 'r.txt'], ['commit', '-qm', 'r'], ['push', '-q']]) execFileSync('git', a, { cwd: other, env: fx.env })
    fx.commitFile('a.txt', 'a\n')
    const toolbar = app.win.getByLabel('Toolbar')
    await toolbar.getByRole('button', { name: 'Sync options' }).click()
    await app.win.getByRole('menuitem', { name: 'Fetch' }).click()
    await toolbar.getByRole('button', { name: 'Pull ↓1 ↑1' }).click()
    await expect(toolbar.getByRole('button', { name: 'Push ↑1' })).toBeVisible()
    expect(fx.git(['rev-list', '--parents', '-n1', 'HEAD']).split(' ')).toHaveLength(2)

    await app.close()
    expect(JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8'))).toMatchObject({ theme: 'dark', accent: 'violet', summaryLimit: 50, pullStrategy: 'rebase' })
    // S9: app state files are owner-only (POSIX modes only).
    const json = readdirSync(userData).filter((f) => f.endsWith('.json'))
    expect(json).toEqual(expect.arrayContaining(['settings.json', 'repos.json']))
    if (process.platform !== 'win32') for (const f of json) expect([f, statSync(path.join(userData, f)).mode & 0o777]).toEqual([f, 0o600])
    app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
    await expect.poll(() => dark(app.win)).toBe(true)
    await expect(app.win.locator('html')).toHaveAttribute('data-accent', 'violet')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('Settings → Git → Global: five identity/signing fields load, save, unset, validate; open the global file', async () => {
  const fx = createRepoFixture()
  // Everything here runs in the fixture's isolated HOME / GIT_CONFIG_GLOBAL, never the machine's global config.
  const globalFile = fx.env.GIT_CONFIG_GLOBAL!
  expect(globalFile.startsWith(fx.dir + path.sep)).toBe(true)
  fx.git(['config', '--global', 'user.signingkey', 'ABCD1234'])
  fx.git(['config', '--global', 'gpg.format', 'ssh'])
  fx.git(['config', '--global', 'alias.st', 'status'])
  writeFileSync(path.join(fx.work, 'x.txt'), 'x\n') // a change, so the commit box shows
  const allowed = () =>
    execFileSync('git', ['config', '--global', '--get-regexp', '^(user\\.|commit\\.gpgsign|gpg\\.format)'], { env: fx.env, encoding: 'utf8' }).trim().split('\n')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    const commit = win.getByRole('form', { name: 'Commit' })
    await expect(commit).toContainText('Committing as Test User <test@example.com>')
    await win.getByRole('button', { name: 'Settings' }).click()
    const dialog = win.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('tab', { name: 'Git', exact: true }).click()
    const card = dialog.getByRole('region', { name: 'Global' })
    const sign = card.getByRole('radiogroup', { name: 'Sign commits (commit.gpgsign)' })
    const format = card.getByRole('radiogroup', { name: 'Signature format (gpg.format)' })
    await expect(card.getByLabel('Name (user.name)')).toHaveValue('Test User')
    await expect(card.getByLabel('Email (user.email)')).toHaveValue('test@example.com')
    await expect(card.getByLabel('Signing key (user.signingkey)')).toHaveValue('ABCD1234')
    await expect(sign.getByRole('radio', { name: 'No', exact: true })).toBeChecked()
    await expect(format.getByRole('radio', { name: 'SSH' })).toBeChecked()
    const before = allowed()

    // Invalid (over the length cap): an error, nothing written.
    await card.getByLabel('Name (user.name)').fill('x'.repeat(257))
    await card.getByRole('button', { name: 'Save identity' }).click()
    await expect(card.getByRole('status')).toContainText('Name (user.name):')
    expect(allowed()).toEqual(before)

    const key = 'key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK0wmN/Cr3JXqmLW7u+g9pTh+wyqDHpSQEIQczXkVx9q me@example.com'
    await card.getByLabel('Name (user.name)').fill('New Name')
    await card.getByLabel('Email (user.email)').fill('new@example.com')
    await card.getByLabel('Signing key (user.signingkey)').fill(key)
    await sign.getByText('Yes', { exact: true }).click()
    await format.getByText('OpenPGP', { exact: true }).click()
    await card.getByRole('button', { name: 'Save identity' }).click()
    await expect(card.getByRole('status')).toHaveText('Saved')
    expect(allowed().sort()).toEqual(['commit.gpgsign true', 'gpg.format openpgp', `user.email new@example.com`, 'user.name New Name', `user.signingkey ${key}`])
    expect(fx.git(['config', '--global', 'alias.st'])).toBe('status')

    // Empty / Not set unsets the key.
    await card.getByLabel('Signing key (user.signingkey)').fill('')
    await sign.getByText('Not set', { exact: true }).click()
    await format.getByText('Not set', { exact: true }).click()
    await card.getByRole('button', { name: 'Save identity' }).click()
    await expect.poll(allowed).toEqual(['user.name New Name', 'user.email new@example.com'])
    await expect(card.getByRole('status')).toHaveText('Saved')

    if (process.platform !== 'win32') {
      // shortcut: the fake editor is a shell script (macOS/Linux); Windows launch is covered by external.spec's skip too.
      const editor = path.join(fx.dir, 'editor.sh')
      writeFileSync(editor, `#!/bin/sh\nprintf '%s|%s\\n' "$PWD" "$*" >> "${editor}.log"\n`)
      chmodSync(editor, 0o755)
      await dialog.getByRole('tab', { name: 'General' }).click()
      await stubOpenDialog(app.app, editor)
      await dialog.getByRole('button', { name: 'Choose custom editor…' }).click()
      await dialog.getByRole('tab', { name: 'Git', exact: true }).click()
      await card.getByRole('button', { name: 'Open global git config…' }).click()
      await expect.poll(() => (existsSync(`${editor}.log`) ? readFileSync(`${editor}.log`, 'utf8') : '')).toBe(`${path.dirname(globalFile)}|${globalFile}\n`)
    }
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(commit).toContainText('Committing as New Name <new@example.com>')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('soft themes apply at once, persist across restart, and clear on Dark / Light / System', async () => {
  const fx = createRepoFixture()
  const userData = path.join(fx.dir, 'userData')
  let app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
  const html = () => app.win.locator('html')
  const bg = () => app.win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())
  try {
    await openRepo(app, fx.work)
    await app.win.getByRole('button', { name: 'Settings' }).click()
    const dialog = app.win.getByRole('dialog', { name: 'Settings' })
    await dialog.getByText('Dark', { exact: true }).click()
    await expect.poll(() => dark(app.win)).toBe(true)
    const darkBg = await bg()
    await dialog.getByText('Soft dark', { exact: true }).click()
    await expect(html()).toHaveAttribute('data-theme', 'soft-dark')
    expect(await dark(app.win)).toBe(true)
    expect(await bg()).not.toBe(darkBg)
    await dialog.getByText('Dark', { exact: true }).click()
    await expect(html()).not.toHaveAttribute('data-theme')
    expect(await bg()).toBe(darkBg)

    await dialog.getByText('Light', { exact: true }).click()
    await expect.poll(() => dark(app.win)).toBe(false)
    const lightBg = await bg()
    await dialog.getByText('Soft light', { exact: true }).click()
    await expect(html()).toHaveAttribute('data-theme', 'soft-light')
    expect(await dark(app.win)).toBe(false)
    expect(await bg()).not.toBe(lightBg)
    await dialog.getByText('System', { exact: true }).click()
    await expect(html()).not.toHaveAttribute('data-theme')
    await dialog.getByText('Soft light', { exact: true }).click()
    await expect(html()).toHaveAttribute('data-theme', 'soft-light')
    await expect.poll(() => dark(app.win)).toBe(false)
    await dialog.getByText('Light', { exact: true }).click()
    await expect(html()).not.toHaveAttribute('data-theme')
    await dialog.getByText('Soft dark', { exact: true }).click()
    await expect.poll(() => dark(app.win)).toBe(true)

    await app.close()
    expect(JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8'))).toMatchObject({ theme: 'soft-dark' })
    app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
    await expect(html()).toHaveAttribute('data-theme', 'soft-dark')
    await expect.poll(() => dark(app.win)).toBe(true)
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('reopen last repo off starts on the welcome screen', async () => {
  const fx = createRepoFixture()
  const userData = path.join(fx.dir, 'userData')
  let app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
  try {
    await openRepo(app, fx.work)
    await app.win.getByRole('button', { name: 'Settings' }).click()
    await app.win.getByText('Reopen last repository on start').click()
    await app.close()
    app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
    await expect(app.win.getByRole('button', { name: 'Open local repository…' })).toBeVisible()
  } finally {
    await app.close()
    fx.cleanup()
  }
})
