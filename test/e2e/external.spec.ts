import { expect, test, type ElectronApplication } from '@playwright/test'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp, openRepo, stubOpenDialog } from './launch'

const click = (app: ElectronApplication, id: string) => app.evaluate(({ Menu }, i) => Menu.getApplicationMenu()!.getMenuItemById(i)!.click(), id)

// shortcut: the fake tools are shell scripts, so this runs on macOS/Linux only; Windows launch is unverified by e2e.
test.skip(process.platform === 'win32', 'fake editor/terminal are shell scripts')

test('custom editor and terminal are launched with the repo path, system default uses the OS', async () => {
  const fx = createRepoFixture()
  const tool = (name: string) => {
    const file = path.join(fx.dir, `${name}.sh`)
    writeFileSync(file, `#!/bin/sh\nprintf '%s|%s\\n' "$PWD" "$*" >> "${file}.log"\n`)
    chmodSync(file, 0o755)
    return { file, log: () => (existsSync(`${file}.log`) ? readFileSync(`${file}.log`, 'utf8') : '') }
  }
  const editor = tool('editor')
  const terminal = tool('terminal')
  const l = await launchApp(fx.env)
  const { app, win } = l
  try {
    await openRepo(l, fx.work)
    await win.getByRole('button', { name: 'Settings' }).click()
    const dialog = win.getByRole('dialog', { name: 'Settings' })
    // A non-executable file is refused by main.
    writeFileSync(path.join(fx.dir, 'plain.txt'), 'x')
    await stubOpenDialog(app, path.join(fx.dir, 'plain.txt'))
    await dialog.getByRole('button', { name: 'Choose custom editor…' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Not an application or executable')
    await stubOpenDialog(app, editor.file)
    await dialog.getByRole('button', { name: 'Choose custom editor…' }).click()
    await expect(dialog.getByRole('radio', { name: `Custom: ${editor.file}` })).toBeChecked()
    await stubOpenDialog(app, terminal.file)
    await dialog.getByRole('button', { name: 'Choose custom terminal…' }).click()
    await expect(dialog.getByRole('radio', { name: `Custom: ${terminal.file}` })).toBeChecked()
    await dialog.getByRole('button', { name: 'Done' }).click()

    await win.getByRole('button', { name: 'Open in editor' }).click() // Changes empty state
    await expect.poll(editor.log).toBe(`${fx.work}|${fx.work}\n`)
    await click(app, 'repo:editor')
    await expect.poll(() => editor.log().split('\n').length).toBe(3)
    await click(app, 'repo:terminal')
    await expect.poll(terminal.log).toBe(`${fx.work}|\n`)

    // System default editor = shell.openPath.
    await app.evaluate(({ shell }) => {
      shell.openPath = (async (p: string) => (((globalThis as Record<string, unknown>).__opened = p), '')) as never
    })
    await win.getByRole('button', { name: 'Settings' }).click()
    await dialog.getByText('System default', { exact: true }).first().click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await win.getByRole('button', { name: 'Open in editor' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).__opened)).toBe(fx.work)
  } finally {
    await l.close()
    fx.cleanup()
  }
})
