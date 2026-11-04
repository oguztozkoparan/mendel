import { expect, test, type ElectronApplication } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, stubMessageBox } from './launch'

type G = Record<string, unknown>
/** Keep the last native popup in `__menu` instead of showing it; record reveals. */
const capturePopups = (app: ElectronApplication) =>
  app.evaluate(({ Menu, shell }) => {
    Menu.prototype.popup = function (this: Electron.Menu) {
      ;(globalThis as G).__menu = this
    }
    shell.showItemInFolder = (p: string) => void ((globalThis as G).__revealed = p)
  })
const pick = (app: ElectronApplication, id: string) => app.evaluate((_e, i) => ((globalThis as G).__menu as Electron.Menu).getMenuItemById(i)!.click(), id)
const enabled = (app: ElectronApplication, id: string) => app.evaluate((_e, i) => ((globalThis as G).__menu as Electron.Menu).getMenuItemById(i)!.enabled, id)

test('changed-file right-click: ignore, reveal, copy path, discard', async () => {
  const fx = createRepoFixture()
  writeFileSync(path.join(fx.work, 'junk.log'), 'x\n')
  writeFileSync(path.join(fx.work, 'README.md'), 'changed\n')
  const l = await launchApp(fx.env)
  const { app, win } = l
  try {
    await openRepo(l, fx.work)
    await capturePopups(app)
    const list = win.getByRole('grid', { name: 'Changed files' })
    const menuFor = async (name: string) => {
      await app.evaluate(() => void ((globalThis as G).__menu = null))
      await list.getByRole('row', { name }).click({ button: 'right' })
      await expect.poll(() => app.evaluate(() => !!(globalThis as G).__menu)).toBe(true)
    }

    await menuFor('README.md')
    expect(await enabled(app, 'ignore')).toBe(false) // tracked: ignoring has no effect
    await pick(app, 'copyRelative')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('README.md')
    await menuFor('README.md')
    await pick(app, 'copy')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(path.join(fx.work, 'README.md'))
    await menuFor('README.md')
    await pick(app, 'reveal')
    await expect.poll(() => app.evaluate(() => (globalThis as G).__revealed)).toBe(path.join(fx.work, 'README.md'))

    await menuFor('junk.log')
    await pick(app, 'ignore')
    await expect(list.getByRole('row', { name: 'junk.log' })).toHaveCount(0)
    expect(readFileSync(path.join(fx.work, '.gitignore'), 'utf8')).toBe('/junk.log\n')

    await stubMessageBox(app, 0)
    await menuFor('README.md')
    await pick(app, 'discard')
    await expect(list.getByRole('row', { name: 'README.md' })).toHaveCount(0)
    expect(readFileSync(path.join(fx.work, 'README.md'), 'utf8')).toBe('# fixture\n')
  } finally {
    await l.close()
    fx.cleanup()
  }
})
