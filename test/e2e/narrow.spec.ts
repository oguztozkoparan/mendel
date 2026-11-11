import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { startGerritMock } from '../fixtures/gerrit-mock'
import { startGithubMock } from '../fixtures/github-mock'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

/** Elements that overflow sideways: wider content than box (not a horizontal scroller), or poking past the window edge. */
const overflow = (win: Page) =>
  win.evaluate(() => {
    const w = document.documentElement.clientWidth
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getClientRects().length && !el.closest('.diff, [role="dialog"] pre, [hidden]'))
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const ox = getComputedStyle(el).overflowX
        const clipped = el.scrollWidth > el.clientWidth + 1 && ox !== 'auto' && ox !== 'scroll' && el.clientWidth > 1 && !(el.tagName === 'SMALL' || getComputedStyle(el).textOverflow === 'ellipsis')
        return r.right > w + 1 || clipped
      })
      .map((el) => `${el.tagName}.${el.className} "${(el.textContent ?? '').slice(0, 30)}" ${el.scrollWidth}/${el.clientWidth} right=${Math.round(el.getBoundingClientRect().right)}`)
  })

test('no horizontal overflow or clipped buttons at the minimum window width', async () => {
  const fx = createRepoFixture()
  // long trailer name (person chip) and a long branch (the commit button) must end in an ellipsis, not clip
  fx.commitFile('some/deeply/nested/folder/with-a-rather-long-file-name.txt', 'one\n', 'add file\n\nReviewed-by: Maximilian Alexander Featherstonehaugh-Montgomery <max@example.com>')
  fx.git(['checkout', '-q', '-b', 'feature/a-rather-long-branch-name-that-overflows-the-commit-button'])
  writeFileSync(path.join(fx.work, 'some/deeply/nested/folder/with-a-rather-long-file-name.txt'), 'one\ntwo\n')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    const min = await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())
    for (const width of [min[0]!, 900, 1080]) {
      await app.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setSize(w, 700), width)
      await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(width)
      if (width === min[0]) await openRepo(app, fx.work)
      await win.getByRole('row', { name: /with-a-rather-long-file-name/ }).click()
      await expect(win.getByRole('region', { name: 'Unstaged diff' })).toBeVisible()
      expect(await overflow(win), `Changes at ${width}px`).toEqual([])
      await win.getByRole('tab', { name: 'History' }).click()
      await win.getByRole('row').first().click()
      expect(await overflow(win), `History at ${width}px`).toEqual([])
      await win.getByRole('tab', { name: 'Changes' }).click()
    }
    await app.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setSize(w, 700), min[0]!)
    await win.getByRole('button', { name: 'Settings' }).click()
    expect(await overflow(win), 'Settings').toEqual([])
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('GitHub Pull requests sign-in card and dialog fit the minimum window', async () => {
  const fx = createRepoFixture()
  const url = 'https://github.com/an-organization-with-a-long-name/a-repository-name-that-goes-on-and-on-and-on.git'
  fx.git(['remote', 'set-url', 'origin', url])
  fx.git(['config', '--global', `url.${fx.remote}.insteadOf`, url])
  const mock = await startGithubMock({ pending: 1000 })
  const app = await launchApp({ ...fx.env, MENDEL_E2E_GITHUB: mock.url })
  const { win } = app
  try {
    const min = await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())
    await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), min as [number, number])
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(min[0]!)
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'Pull requests' }).click()
    await expect(win.getByRole('region', { name: 'Sign in to GitHub' })).toBeVisible()
    expect(await overflow(win), 'Pull requests').toEqual([])
    await win.getByRole('button', { name: 'Sign in…' }).click()
    const dialog = win.getByRole('dialog', { name: 'Sign in to GitHub' })
    await expect(dialog.getByLabel('Your code')).toHaveText(mock.userCode)
    expect(await overflow(win), 'Sign-in dialog').toEqual([])
    const box = (await dialog.boundingBox())!
    const size = await win.evaluate(() => [window.innerWidth, window.innerHeight])
    expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= size[0]! && box.y + box.height <= size[1]!, 'dialog inside the window').toBe(true)
  } finally {
    await app.close()
    await mock.close()
    fx.cleanup()
  }
})

test('Settings → Git providers fits the minimum window with a long Gerrit host and a long GitHub login', async () => {
  const fx = createRepoFixture()
  const host = 'gerrit.a-very-long-gerrit-host-name-of-some-department.example.test'
  const url = `ssh://test@${host}:29418/p/q`
  fx.git(['remote', 'set-url', 'origin', url])
  fx.git(['config', '--global', `url.${fx.remote}.insteadOf`, url])
  const gerrit = await startGerritMock()
  const github = await startGithubMock({ login: 'a-github-login-that-is-very-long-indeed-and-goes-on', pending: 0 })
  const userData = path.join(fx.dir, 'userData')
  mkdirSync(userData)
  // Probe result pre-cached: no network probe of the made-up host.
  writeFileSync(path.join(userData, 'providers.json'), JSON.stringify({ hosts: { [host]: { baseUrl: gerrit.url, version: '3.1.3' } } }))
  const app = await launchApp({ ...fx.env, MENDEL_E2E_USERDATA: userData, MENDEL_E2E_GITHUB: github.url })
  const { win } = app
  try {
    const min = await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())
    await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), min as [number, number])
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(min[0]!)
    await openRepo(app, fx.work)
    await win.getByRole('button', { name: 'Settings' }).click()
    const settings = win.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('tab', { name: 'Git providers' }).click()
    await expect(settings.getByRole('region', { name: 'Gerrit' })).toContainText(host)
    // Sign-in is per host: it works from a Gerrit repo too.
    const card = settings.getByRole('region', { name: 'GitHub' })
    await card.getByRole('button', { name: 'Sign in…' }).click()
    await expect(card).toContainText(`Signed in as ${github.login}`)
    expect(await overflow(win), 'Git providers').toEqual([])
    const box = (await settings.boundingBox())!
    const size = await win.evaluate(() => [window.innerWidth, window.innerHeight])
    expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= size[0]! && box.y + box.height <= size[1]!, 'Settings inside the window').toBe(true)
  } finally {
    await app.close()
    await github.close()
    await gerrit.close()
    fx.cleanup()
  }
})
