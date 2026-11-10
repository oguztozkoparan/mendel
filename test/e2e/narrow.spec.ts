import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
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
