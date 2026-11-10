import { expect, test } from '@playwright/test'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

test('conflicted file shows a hint and Mark resolved instead of crashing the diff', async () => {
  const fx = createRepoFixture()
  fx.git(['switch', '-q', '-c', 'other'])
  fx.commitFile('README.md', 'theirs\n')
  fx.git(['switch', '-q', 'main'])
  fx.commitFile('README.md', 'ours\n')
  expect(() => fx.git(['merge', 'other'])).toThrow()
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await expect(win.getByText('Conflicted file.')).toBeVisible()
    // the pane's own button, not the conflicts banner's (it sits at the top of the same pane)
    await win.locator('section', { hasText: 'Conflicted file.' }).locator(':scope > :not([aria-label="Conflicts"])').getByRole('button', { name: 'Mark resolved' }).click()
    await expect.poll(() => fx.git(['ls-files', '--unmerged'])).toBe('')
  } finally {
    await app.close()
    fx.cleanup()
  }
})
