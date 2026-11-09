import { expect, test } from '@playwright/test'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, stubMessageBox } from './launch'

test('history: create an annotated tag on a commit, push it, delete it', async () => {
  const fx = createRepoFixture()
  const sha = fx.commitFile('a.txt', 'a\n', 'Add a')
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'History' }).click()
    const detail = win.getByLabel('Commit detail')
    await expect(detail).toContainText(sha)

    await detail.getByLabel('Tag name').fill('-bad')
    await detail.getByRole('button', { name: 'Create tag' }).click()
    await expect(detail.getByRole('alert')).toContainText('Invalid tag name')

    await detail.getByLabel('Tag name').fill('v1.0')
    await detail.getByLabel('Message (optional, annotated)').fill('First release')
    await detail.getByRole('button', { name: 'Create tag' }).click()
    const tag = detail.getByLabel('Tag v1.0')
    await expect(tag).toBeVisible()
    expect(fx.git(['cat-file', '-t', 'v1.0'])).toBe('tag')
    expect(fx.git(['rev-parse', 'v1.0^{commit}'])).toBe(sha)

    await tag.getByRole('button', { name: 'Push' }).click()
    await expect.poll(() => fx.git(['tag', '-l'], fx.remote)).toBe('v1.0')

    await stubMessageBox(app.app, 0)
    await tag.getByRole('button', { name: 'Delete…' }).click()
    await expect(tag).toHaveCount(0)
    expect(fx.git(['tag', '-l'])).toBe('')
  } finally {
    await app.close()
    fx.cleanup()
  }
})
