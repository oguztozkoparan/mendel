import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

test('Settings → Git → This repository: assign a profile, the terminal agrees, a project value overrides, unassign', async () => {
  const fx = createRepoFixture()
  const userData = path.join(fx.dir, 'userData')
  const assignments = path.join(userData, 'git-profiles', 'assignments.gitconfig')
  // Everything below runs in the fixture's temp dir: never the machine's global git config or real userData.
  const globalFile = fx.env.GIT_CONFIG_GLOBAL!
  expect(globalFile.startsWith(fx.dir + path.sep)).toBe(true)
  const includes = () => {
    try {
      return execFileSync('git', ['config', '--global', '--get-all', 'include.path'], { env: fx.env, encoding: 'utf8' }).trim().split('\n')
    } catch {
      return [] // exit 1: none
    }
  }
  writeFileSync(path.join(fx.work, 'x.txt'), 'x\n') // a change, so the commit box shows
  const app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
  const { win } = app
  try {
    expect(await app.app.evaluate(({ app }) => [app.getPath('userData'), process.env.GIT_CONFIG_GLOBAL])).toEqual([userData, globalFile])
    await openRepo(app, fx.work)
    const commit = win.getByRole('form', { name: 'Commit' })
    await expect(commit).toContainText('Committing as Test User <test@example.com>')
    await win.getByRole('button', { name: 'Settings' }).click()
    const settings = win.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('tab', { name: 'Git', exact: true }).click()
    const profiles = settings.getByRole('region', { name: 'Profiles' })
    const card = settings.getByRole('region', { name: 'This repository' })
    const row = (label: string) => card.getByRole('group', { name: label })

    await profiles.getByRole('button', { name: 'Add profile…' }).click()
    const dlg = win.getByRole('dialog', { name: 'Add profile' })
    await dlg.getByLabel('Profile name').fill('Work')
    await dlg.getByLabel('Name (user.name)').fill('Work Person')
    await dlg.getByLabel('Email (user.email)').fill('work@example.com')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toHaveCount(0)
    const work = profiles.getByRole('group', { name: 'Work' })
    await expect(work).toContainText('Used by no repositories')

    // Not assigned: everything from the global config.
    await expect(card.getByLabel('Profile')).toHaveValue('')
    await expect(row('user.email')).toContainText('test@example.com')
    await expect(row('user.email')).toContainText('Global')
    await expect(row('user.signingkey')).toContainText('Not set')

    await card.getByLabel('Profile').selectOption({ label: 'Work' })
    await expect(row('user.email')).toContainText('work@example.com')
    await expect(row('user.email')).toContainText('Profile Work')
    await expect(row('user.name')).toContainText('Profile Work')
    await expect(row('commit.gpgsign')).toContainText('Global') // the fixture's global gpgsign = false
    await expect(row('gpg.format')).toContainText('Not set')
    await expect(work).toContainText('Used by 1 repository')
    // The terminal agrees; the global config has exactly one include line, into this test's userData.
    expect(fx.git(['config', 'user.email'])).toBe('work@example.com')
    expect(includes()).toEqual([assignments])
    expect(existsSync(assignments)).toBe(true)

    // A project value set with git overrides the profile.
    fx.git(['config', 'user.email', 'project@example.com'])
    await win.evaluate(() => (window.dispatchEvent(new Event('blur')), window.dispatchEvent(new Event('focus'))))
    await expect(row('user.email')).toContainText('project@example.com')
    await expect(row('user.email')).toContainText('Project · overrides profile Work')
    fx.git(['config', '--unset', 'user.email'])

    // mendel's include line removed by hand: the card says the profile is not applied; Apply again repairs it.
    fx.git(['config', '--global', '--unset', 'include.path'])
    await win.evaluate(() => (window.dispatchEvent(new Event('blur')), window.dispatchEvent(new Event('focus'))))
    await expect(card.getByRole('status')).toContainText('Profile Work is not applied')
    await expect(row('user.email')).toContainText('Global')
    await card.getByRole('button', { name: 'Apply again' }).click()
    await expect(card.getByRole('status')).toHaveCount(0)
    await expect(row('user.email')).toContainText('Profile Work')
    expect(includes()).toEqual([assignments])

    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(commit).toContainText('Committing as Work Person <work@example.com>')

    // Unassign: back to global everywhere, the include line removed.
    await win.getByRole('button', { name: 'Settings' }).click()
    await settings.getByRole('tab', { name: 'Git', exact: true }).click()
    await card.getByLabel('Profile').selectOption({ label: 'None' })
    await expect(row('user.email')).toContainText('Global')
    await expect(row('user.email')).toContainText('test@example.com')
    await expect(work).toContainText('Used by no repositories')
    expect(fx.git(['config', 'user.email'])).toBe('test@example.com')
    expect(includes()).toEqual([])
    expect(existsSync(assignments)).toBe(false)
    expect(readFileSync(globalFile, 'utf8')).toContain('email = test@example.com')
    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(commit).toContainText('Committing as Test User <test@example.com>')

    // Deleting an assigned profile names its use, unassigns, removes the line and refreshes "Committing as …".
    await win.getByRole('button', { name: 'Settings' }).click()
    await settings.getByRole('tab', { name: 'Git', exact: true }).click()
    await card.getByLabel('Profile').selectOption({ label: 'Work' })
    await expect(work).toContainText('Used by 1 repository')
    await app.app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async (...a: unknown[]) => (((globalThis as Record<string, unknown>).asked = a.at(-1)), { response: 0, checkboxChecked: false })) as never
    })
    await work.getByRole('button', { name: 'Delete Work' }).click()
    await expect(work).toHaveCount(0)
    expect(await app.app.evaluate(() => ((globalThis as Record<string, unknown>).asked as { detail: string }).detail)).toContain('One repository uses it and will use the global config again.')
    await expect(card.getByLabel('Profile')).toHaveValue('')
    await expect(row('user.email')).toContainText('Global')
    expect(includes()).toEqual([])
    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(commit).toContainText('Committing as Test User <test@example.com>')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('Settings → Git → This repository: project values override the profile, Use profile and Remove, errors and cancel write nothing', async () => {
  const fx = createRepoFixture()
  const userData = path.join(fx.dir, 'userData')
  const globalFile = fx.env.GIT_CONFIG_GLOBAL!
  expect(globalFile.startsWith(fx.dir + path.sep)).toBe(true)
  const globalBefore = readFileSync(globalFile, 'utf8')
  const local = () => fx.git(['config', '--local', '--list']).split('\n')
  const localBefore = local()
  writeFileSync(path.join(fx.work, 'x.txt'), 'x\n')
  const app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData })
  const { win } = app
  try {
    expect(await app.app.evaluate(({ app }) => [app.getPath('userData'), process.env.GIT_CONFIG_GLOBAL])).toEqual([userData, globalFile])
    await openRepo(app, fx.work)
    const commit = win.getByRole('form', { name: 'Commit' })
    await win.getByRole('button', { name: 'Settings' }).click()
    const settings = win.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('tab', { name: 'Git', exact: true }).click()
    const card = settings.getByRole('region', { name: 'This repository' })
    const row = (label: string) => card.getByRole('group', { name: label })
    const dlg = win.getByRole('dialog', { name: 'Project values' })
    const open = () => card.getByRole('button', { name: 'Project values…' }).click()

    // No profile: set and remove a project value.
    await open()
    await expect(dlg.getByLabel('Email (user.email)')).toHaveValue('') // project values only, never the inherited one
    await dlg.getByLabel('Name (user.name)').fill('Proj Name')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(row('user.name')).toContainText('Proj Name')
    await expect(row('user.name')).toContainText('Project')
    expect(local()).toEqual([...localBefore, 'user.name=Proj Name'])
    await row('user.name').getByRole('button', { name: 'Remove project value for user.name' }).click()
    await expect(row('user.name')).toContainText('Global')
    await expect(row('user.name').getByRole('button')).toHaveCount(0)
    expect(local()).toEqual(localBefore)

    // An invalid value shows the error and writes nothing; Cancel writes nothing.
    await open()
    await dlg.getByLabel('Email (user.email)').fill('a b@example.com')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByRole('alert')).toContainText('Email (user.email): Spaces, < and > are not allowed')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toHaveCount(0)
    await open()
    await dlg.getByLabel('Email (user.email)').fill('cancelled@example.com')
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg).toHaveCount(0)
    expect(local()).toEqual(localBefore)

    // With a profile assigned: a project email overrides it everywhere; Use profile removes it.
    await settings.getByRole('region', { name: 'Profiles' }).getByRole('button', { name: 'Add profile…' }).click()
    const add = win.getByRole('dialog', { name: 'Add profile' })
    await add.getByLabel('Profile name').fill('Work')
    await add.getByLabel('Email (user.email)').fill('work@example.com')
    await add.getByRole('button', { name: 'Save' }).click()
    await card.getByLabel('Profile').selectOption({ label: 'Work' })
    await expect(row('user.email')).toContainText('Profile Work')
    await open()
    await dlg.getByLabel('Email (user.email)').fill('project@example.com')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(row('user.email')).toContainText('Project · overrides profile Work')
    expect(fx.git(['config', 'user.email'])).toBe('project@example.com')
    expect(local()).toEqual([...localBefore, 'user.email=project@example.com'])
    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(commit).toContainText('Committing as Test User <project@example.com>')

    await win.getByRole('button', { name: 'Settings' }).click()
    await settings.getByRole('tab', { name: 'Git', exact: true }).click()
    await row('user.email').getByRole('button', { name: 'Use profile for user.email' }).click()
    await expect(row('user.email')).toContainText('Profile Work')
    await expect(row('user.email')).toContainText('work@example.com')
    expect(fx.git(['config', 'user.email'])).toBe('work@example.com')
    expect(local()).toEqual(localBefore)
    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(commit).toContainText('Committing as Test User <work@example.com>')
    // The global file gained only mendel's include line.
    expect(readFileSync(globalFile, 'utf8').replace(/\[include\]\n\tpath = .*\n/, '')).toBe(globalBefore)
  } finally {
    await app.close()
    fx.cleanup()
  }
})
