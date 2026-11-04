import { expect, test } from '@playwright/test'
import { basic, startAuthRemote } from '../fixtures/auth-remote'
import { createRepoFixture } from '../fixtures/repo'
import { launchApp } from './launch'

type TestGlobal = { __gitdockTest: { git(args: string[], o: { cwd: string }): Promise<unknown> } }

/** Run git through the app's real runner in main (e2e seam); resolves to the error kind or 'ok'. */
const runGit = (app: Awaited<ReturnType<typeof launchApp>>['app'], args: string[], cwd: string) =>
  app.evaluate(
    (_e, [a, c]) =>
      (globalThis as unknown as TestGlobal).__gitdockTest.git(a, { cwd: c }).then(
        () => 'ok',
        (err: { kind: string }) => err.kind
      ),
    [args, cwd] as const
  )

/** Prompts are pushed to the renderer as events; one sent before it has subscribed is lost, so wait for the UI first. */
const uiReady = (win: Awaited<ReturnType<typeof launchApp>>['win']) => win.getByRole('button', { name: 'Open local repository…' }).waitFor()

test('git credential prompts show as modal and reach git', async () => {
  const fx = createRepoFixture()
  const remote = await startAuthRemote()
  const { app, win, close } = await launchApp(fx.env)
  try {
    await uiReady(win)
    const result = runGit(app, ['ls-remote', `${remote.url}/repo.git`], fx.work)
    const dialog = win.getByRole('dialog', { name: 'Authentication required' })
    await expect(dialog).toContainText(`Username for '${remote.url}'`)
    await dialog.getByRole('textbox').fill('alice')
    await dialog.getByRole('button', { name: 'OK' }).click()
    await expect(dialog).toContainText('Password for')
    await expect(dialog.locator('input[type=password]')).toBeVisible()
    await dialog.locator('input').fill('s3cret')
    await dialog.getByRole('button', { name: 'OK' }).click()
    expect(await result).toBe('AuthFailed') // mock remote rejects every credential
    expect(remote.requests.some((r) => r.headers.authorization === basic('alice', 's3cret'))).toBe(true)
  } finally {
    await close()
    await remote.close()
    fx.cleanup()
  }
})

test('cancelling the prompt aborts git quickly', async () => {
  const fx = createRepoFixture()
  const remote = await startAuthRemote()
  const { app, win, close } = await launchApp(fx.env)
  try {
    await uiReady(win)
    const result = runGit(app, ['ls-remote', `${remote.url}/repo.git`], fx.work)
    await win.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    const t = Date.now()
    expect(await result).toBe('AuthFailed')
    expect(Date.now() - t).toBeLessThan(5000)
    await expect(win.getByRole('dialog')).toHaveCount(0)
  } finally {
    await close()
    await remote.close()
    fx.cleanup()
  }
})
