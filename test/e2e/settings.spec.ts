import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

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

test('Vesper and Lauds apply at once, persist across restart, and clear on Dark / Light / System', async () => {
  const fx = createRepoFixture()
  const userData = path.join(fx.dir, 'userData')
  let app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
  const html = () => app.win.locator('html')
  const tok = (name: string) => app.win.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)
  const bg = () => tok('--bg')
  try {
    await openRepo(app, fx.work)
    await app.win.getByRole('button', { name: 'Settings' }).click()
    const dialog = app.win.getByRole('dialog', { name: 'Settings' })
    await dialog.getByText('Dark', { exact: true }).click()
    await expect.poll(() => dark(app.win)).toBe(true)
    const darkBg = await bg()
    const darkMutedGlass = await tok('--muted-glass')
    await dialog.getByText('Vesper', { exact: true }).click()
    await expect(html()).toHaveAttribute('data-theme', 'vesper')
    expect(await dark(app.win)).toBe(true)
    expect(await bg()).not.toBe(darkBg)
    // own glass muted: the inherited one sits too close to 4.5:1 on the selected row (sidebar secondary text)
    expect(await tok('--muted-glass')).not.toBe(darkMutedGlass)
    await dialog.getByText('Dark', { exact: true }).click()
    await expect(html()).not.toHaveAttribute('data-theme')
    expect(await bg()).toBe(darkBg)

    await dialog.getByText('Light', { exact: true }).click()
    await expect.poll(() => dark(app.win)).toBe(false)
    const lightBg = await bg()
    const lightMutedGlass = await tok('--muted-glass')
    await dialog.getByText('Lauds', { exact: true }).click()
    await expect(html()).toHaveAttribute('data-theme', 'lauds')
    expect(await dark(app.win)).toBe(false)
    expect(await bg()).not.toBe(lightBg)
    expect(await tok('--muted-glass')).not.toBe(lightMutedGlass)
    await dialog.getByText('System', { exact: true }).click()
    await expect(html()).not.toHaveAttribute('data-theme')
    await dialog.getByText('Lauds', { exact: true }).click()
    await expect(html()).toHaveAttribute('data-theme', 'lauds')
    await expect.poll(() => dark(app.win)).toBe(false)
    await dialog.getByText('Light', { exact: true }).click()
    await expect(html()).not.toHaveAttribute('data-theme')
    await dialog.getByText('Vesper', { exact: true }).click()
    await expect.poll(() => dark(app.win)).toBe(true)

    await app.close()
    expect(JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8'))).toMatchObject({ theme: 'vesper' })
    app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
    await expect(html()).toHaveAttribute('data-theme', 'vesper')
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
