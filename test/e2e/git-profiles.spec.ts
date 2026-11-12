import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, stubMessageBox, type LaunchedApp } from './launch'

test('Settings → Git → Profiles: add, edit, refuse invalid, delete with confirm, survive a restart', async () => {
  const fx = createRepoFixture()
  const userData = path.join(fx.dir, 'userData')
  const dir = path.join(userData, 'git-profiles')
  // Everything below runs in the fixture's temp dir: never the machine's global git config or real userData.
  expect(fx.env.GIT_CONFIG_GLOBAL!.startsWith(fx.dir + path.sep)).toBe(true)
  const globalBefore = readFileSync(fx.env.GIT_CONFIG_GLOBAL!, 'utf8')
  const index = () => JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8')) as { profiles: { id: string; name: string }[] }
  const keys = (id: string) => execFileSync('git', ['config', '--file', path.join(dir, `${id}.gitconfig`), '--list'], { env: fx.env, encoding: 'utf8' }).trim().split('\n').sort()
  const key = 'key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK0wmN/Cr3JXqmLW7u+g9pTh+wyqDHpSQEIQczXkVx9q me@example.com'

  const open = async (app: LaunchedApp) => {
    expect(await app.app.evaluate(({ app }) => [app.getPath('userData'), process.env.GIT_CONFIG_GLOBAL])).toEqual([userData, fx.env.GIT_CONFIG_GLOBAL])
    await app.win.getByRole('button', { name: 'Settings' }).click()
    const settings = app.win.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('tab', { name: 'Git', exact: true }).click()
    return settings.getByRole('region', { name: 'Profiles' })
  }

  let app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
  try {
    const { win } = app
    let card = await open(app)
    await expect(card).toContainText('No profiles yet')

    // Add with all five fields.
    await card.getByRole('button', { name: 'Add profile…' }).click()
    let dlg = win.getByRole('dialog', { name: 'Add profile' })
    await dlg.getByLabel('Profile name').fill('  Work  ')
    await dlg.getByLabel('Name (user.name)').fill('Work Person')
    await dlg.getByLabel('Email (user.email)').fill('work@example.com')
    await dlg.getByLabel('Signing key (user.signingkey)').fill(key)
    await dlg.getByRole('radiogroup', { name: 'Sign commits (commit.gpgsign)' }).getByText('Yes', { exact: true }).click()
    await dlg.getByRole('radiogroup', { name: 'Signature format (gpg.format)' }).getByText('SSH', { exact: true }).click()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toHaveCount(0)
    const work = card.getByRole('group', { name: 'Work' })
    await expect(work).toContainText('Work Person <work@example.com>')
    const [{ id, name }] = index().profiles
    expect(name).toBe('Work')
    expect(readdirSync(dir).sort()).toEqual([`${id}.gitconfig`, 'index.json'].sort())
    expect(keys(id!)).toEqual(['commit.gpgsign=true', 'gpg.format=ssh', 'user.email=work@example.com', 'user.name=Work Person', `user.signingkey=${key}`])

    // Refused: a duplicate name (any case), an invalid value, a too-long name. Nothing changes.
    await card.getByRole('button', { name: 'Add profile…' }).click()
    dlg = win.getByRole('dialog', { name: 'Add profile' })
    await expect(dlg.getByLabel('Profile name')).toBeFocused()
    await dlg.getByLabel('Profile name').fill('WORK')
    await dlg.getByLabel('Profile name').press('Enter') // Enter saves; a refused save keeps the dialog open
    await expect(dlg.getByRole('alert')).toHaveText('A profile named "Work" already exists')
    await dlg.getByLabel('Profile name').fill('x'.repeat(65))
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toContainText('Profile name:')
    await dlg.getByLabel('Profile name').fill('Other')
    await dlg.getByLabel('Email (user.email)').fill('a b@example.com')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toHaveText('Email (user.email): Spaces, < and > are not allowed')
    await win.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    expect(index().profiles).toEqual([{ id, name: 'Work' }])
    expect(readdirSync(dir).sort()).toEqual([`${id}.gitconfig`, 'index.json'].sort())

    // Edit: seeded with the profile; rename and unset a field.
    await work.getByRole('button', { name: 'Edit Work' }).click()
    dlg = win.getByRole('dialog', { name: 'Edit profile' })
    await expect(dlg.getByLabel('Profile name')).toHaveValue('Work')
    await expect(dlg.getByLabel('Signing key (user.signingkey)')).toHaveValue(key)
    await dlg.getByLabel('Profile name').fill('Day job')
    await dlg.getByLabel('Signing key (user.signingkey)').fill('')
    // A background refetch (window focus) does not reset the edits; a field the dialog did not change is not written.
    execFileSync('git', ['config', '--file', path.join(dir, `${id}.gitconfig`), 'user.email', 'ext@example.com'], { env: fx.env })
    await win.evaluate(() => (window.dispatchEvent(new Event('blur')), window.dispatchEvent(new Event('focus'))))
    await expect(win.locator('[aria-label="Work"]')).toContainText('<ext@example.com>') // the row behind the dialog refetched
    await expect(dlg.getByLabel('Profile name')).toHaveValue('Day job')
    await expect(dlg.getByLabel('Signing key (user.signingkey)')).toHaveValue('')
    await expect(dlg.getByLabel('Email (user.email)')).toHaveValue('work@example.com')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(card.getByRole('group', { name: 'Day job' })).toContainText('Work Person <ext@example.com>')
    expect(index().profiles).toEqual([{ id, name: 'Day job' }])
    expect(keys(id!)).toEqual(['commit.gpgsign=true', 'gpg.format=ssh', 'user.email=ext@example.com', 'user.name=Work Person'])
    await win.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Done' }).click()
    await app.close()

    // Survives a restart; delete: cancel keeps it, confirm removes row, file and index entry.
    app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
    card = await open(app)
    const row = card.getByRole('group', { name: 'Day job' })
    await expect(row).toContainText('Work Person <ext@example.com> · gpgsign true · format ssh')
    await stubMessageBox(app.app, 1)
    await row.getByRole('button', { name: 'Delete Day job' }).click()
    await app.win.waitForTimeout(300)
    await expect(row).toBeVisible()
    expect(existsSync(path.join(dir, `${id}.gitconfig`))).toBe(true)
    await stubMessageBox(app.app, 0)
    await row.getByRole('button', { name: 'Delete Day job' }).click()
    await expect(row).toHaveCount(0)
    await expect(card).toContainText('No profiles yet')
    expect(existsSync(path.join(dir, `${id}.gitconfig`))).toBe(false)
    expect(index().profiles).toEqual([])
    expect(readFileSync(fx.env.GIT_CONFIG_GLOBAL!, 'utf8')).toBe(globalBefore)
  } finally {
    await app.close()
    fx.cleanup()
  }
})
