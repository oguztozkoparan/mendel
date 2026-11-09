import { expect, test } from '@playwright/test'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo } from './launch'

test('history: edit unpushed commits reorders, rewords, squashes and drops', async () => {
  const fx = createRepoFixture()
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => fx.commitFile(`${n}.txt`, `${n}\n`).slice(0, 7))
  const app = await launchApp(fx.env)
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await win.getByRole('tab', { name: 'History' }).click()
    await win.getByRole('button', { name: 'Edit unpushed commits…' }).click()
    const dialog = win.getByRole('dialog', { name: 'Edit unpushed commits' })
    const list = dialog.getByRole('list', { name: 'Commits to rebase' })
    await expect(list.getByRole('listitem')).toHaveCount(4)
    await expect(list.getByRole('listitem').first()).toContainText('add a.txt')

    // Keyboard: move c above b.
    await dialog.getByRole('button', { name: `Move ${c} up` }).focus()
    await win.keyboard.press('Enter')
    await expect(list.getByRole('listitem').nth(1)).toContainText('add c.txt')
    await dialog.getByLabel(`Action for ${a}`).selectOption('reword')
    const msg = dialog.getByLabel(`New message for ${a}`)
    await expect(msg).toHaveValue(/^add a\.txt\s*$/)
    await msg.fill('first commit')
    await dialog.getByLabel(`Action for ${b}`).selectOption('squash')
    await dialog.getByLabel(`Action for ${d}`).selectOption('drop')
    await dialog.getByRole('button', { name: 'Rebase' }).click()
    await expect(dialog).toHaveCount(0)

    await expect(win.getByRole('grid', { name: 'Commits' }).getByRole('row').first()).toContainText('add c.txt')
    expect(fx.git(['log', '--format=%s', 'origin/main..HEAD'])).toBe('add c.txt\nfirst commit')
    expect(fx.git(['ls-files'])).not.toContain('d.txt')
    expect(fx.git(['ls-files'])).toContain('b.txt')
  } finally {
    await app.close()
    fx.cleanup()
  }
})
