// End-to-end user journeys (PLAN.md §4): one app session each, driven only through the UI where a user would.
import { expect, test, type Locator } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { startGerritMock } from '../fixtures/gerrit-mock'
import { startMockServer } from '../fixtures/mock-server'
import { createRepoFixture } from '../fixtures/repo'
import { connectGerrit, gerritPushOutput, launchGerrit } from './gerrit'
import { launchApp, openRepo, stubOpenDialog } from './launch'

// react-aria hides the native checkbox input; click its visible label like a user does.
const toggle = (cb: Locator) => cb.locator('xpath=ancestor::label').click()
const LINES = Array.from({ length: 30 }, (_, i) => `line ${i}`)

test('generic: clone → edit → stage one hunk → commit → push → History', async () => {
  const fx = createRepoFixture()
  fx.commitFile('f.txt', LINES.join('\n') + '\n')
  fx.git(['push', '-q'])
  const parent = path.join(fx.dir, 'clones')
  mkdirSync(parent)
  const work = path.join(parent, 'mine')
  const app = await launchApp(fx.env)
  const { win } = app
  const toolbar = win.getByLabel('Toolbar')
  try {
    await stubOpenDialog(app.app, parent)
    await win.getByRole('button', { name: 'Clone repository…' }).click()
    const clone = win.getByRole('dialog', { name: 'Clone repository' })
    await clone.getByRole('button', { name: 'Choose…' }).click()
    await clone.getByLabel('Repository URL').fill(pathToFileURL(fx.remote).href)
    await clone.getByLabel('Folder name').fill('mine')
    await clone.getByRole('button', { name: 'Clone' }).click()
    await expect(win.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true')
    await expect(toolbar.getByRole('button', { name: 'Fetch origin' })).toBeVisible()

    writeFileSync(path.join(work, 'f.txt'), LINES.map((l, i) => (i === 1 ? 'first change' : i === 25 ? 'second change' : l)).join('\n') + '\n')
    await win.getByRole('grid', { name: 'Changed files' }).getByRole('row', { name: 'f.txt' }).click()
    await win.getByRole('region', { name: 'Unstaged diff' }).getByRole('button', { name: 'Stage hunk' }).first().click()
    await expect(win.getByRole('region', { name: 'Staged diff', exact: true })).toContainText('first change')

    const box = win.getByRole('form', { name: 'Commit' })
    await box.getByLabel('Summary').fill('Change line 1')
    await box.getByLabel('Description').fill('Only the first hunk.')
    await box.getByRole('button', { name: 'Commit to main' }).click()
    await expect(box.getByLabel('Summary')).toHaveValue('')
    expect(fx.git(['log', '-1', '--format=%B'], work)).toBe('Change line 1\n\nOnly the first hunk.')
    expect(fx.git(['show', '--format=', 'HEAD'], work)).not.toContain('second change')
    expect(fx.git(['diff'], work)).toContain('second change') // other hunk still unstaged

    await toolbar.getByRole('button', { name: 'Push ↑1' }).click()
    await expect(toolbar.getByRole('button', { name: 'Fetch origin' })).toBeVisible()
    expect(fx.git(['log', '-1', '--format=%s', 'main'], fx.remote)).toBe('Change line 1')

    await win.getByRole('tab', { name: 'History' }).click()
    const first = win.getByRole('grid', { name: 'Commits' }).getByRole('row').first()
    await expect(first).toContainText('Change line 1')
    await expect(first).not.toContainText('unpushed')
    await expect(win.getByLabel('Commit detail')).toContainText('Only the first hunk.')
    await expect(win.getByLabel('Commit diff')).toContainText('first change')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('gerrit daily loop: connect → commit → send with topic → amend → new patchset → review → vote → submit', async () => {
  const mock = await startGerritMock()
  const g = await launchGerrit(mock)
  const { win, fx } = g
  const box = win.getByRole('form', { name: 'Commit' })
  const sendDialog = win.getByRole('dialog', { name: 'Send for review' })
  const pushedRefs = () => fx.git(['for-each-ref', '--format=%(refname)', 'refs/for'], fx.remote)
  try {
    await connectGerrit(win, mock)
    await win.getByRole('tab', { name: 'Changes' }).click()
    await expect(box).toContainText('Change-Id will be added by gitdock')

    // Commit through the UI: gitdock adds the Change-Id (no commit-msg hook).
    writeFileSync(path.join(fx.work, 'x.txt'), 'x\n')
    await toggle(win.getByRole('grid', { name: 'Changed files' }).getByRole('row', { name: 'x.txt' }).getByRole('checkbox', { name: 'Staged' }))
    await box.getByLabel('Summary').fill('Add feature X')
    await box.getByRole('button', { name: 'Commit to main' }).click()
    await expect(win.getByText('No local changes')).toBeVisible()
    const changeId = /Change-Id: (I[0-9a-f]{40})$/.exec(fx.git(['log', '-1', '--format=%B']))?.[1]
    expect(changeId).toBeTruthy()

    // First upload creates the change.
    gerritPushOutput(fx, `${mock.url}/c/p/q/+/101 Add feature X [NEW]`)
    await win.getByRole('button', { name: 'Send for review ↑1' }).click()
    await sendDialog.getByLabel('Topic').fill('feature-x')
    await expect(sendDialog.getByLabel('Push ref')).toHaveText('HEAD:refs/for/main%topic=feature-x')
    await sendDialog.getByRole('button', { name: 'Send' }).click()
    await expect(win.getByRole('alert').filter({ hasText: 'Created change #101' })).toBeVisible()
    expect(pushedRefs()).toBe('refs/for/main%topic=feature-x')
    mock.changes[0].change_id = changeId // the server now knows the change

    // Reviewer asks for changes: edit, stage; amend is pre-ticked as a new patchset of #101.
    writeFileSync(path.join(fx.work, 'x.txt'), 'x v2\n')
    await toggle(win.getByRole('grid', { name: 'Changed files' }).getByRole('row', { name: 'x.txt' }).getByRole('checkbox', { name: 'Staged' }))
    await expect(box.getByRole('checkbox', { name: 'Amend last commit' })).toBeChecked()
    await expect(box).toContainText('Will upload a new patchset of #101')
    await expect(box.getByLabel('Summary')).toHaveValue('Add feature X')
    const count = fx.git(['rev-list', '--count', 'HEAD'])
    await box.getByRole('button', { name: 'Amend last commit' }).click()
    await expect(win.getByText('No local changes')).toBeVisible()
    expect(fx.git(['rev-list', '--count', 'HEAD'])).toBe(count)
    expect(fx.git(['log', '-1', '--format=%B'])).toBe(`Add feature X\n\nChange-Id: ${changeId}`)

    // Second upload: existing change → new patchset.
    fx.git(['update-ref', '-d', 'refs/for/main%topic=feature-x'], fx.remote)
    gerritPushOutput(fx, `${mock.url}/c/p/q/+/101 Add feature X`)
    await win.getByRole('button', { name: 'Send for review ↑1' }).click()
    await sendDialog.getByRole('button', { name: 'Send' }).click()
    await expect(win.getByRole('alert').filter({ hasText: 'New patchset uploaded to #101' })).toBeVisible()
    expect(pushedRefs()).toBe('refs/for/main')

    // Reviews tab → detail → reply with a vote → submit.
    await win.getByRole('tab', { name: 'Reviews' }).click()
    await win.getByRole('option', { name: /Add feature X/ }).click()
    await expect(win.getByRole('heading', { name: 'Add feature X' })).toBeVisible()
    await win.getByRole('button', { name: /^Reply…/ }).click()
    const reply = win.getByRole('dialog', { name: 'Reply to #101' })
    await reply.getByLabel('Message').fill('Updated as requested')
    await reply.getByRole('radiogroup', { name: 'Code-Review' }).getByText('+2').click()
    await reply.getByRole('button', { name: 'Send' }).click()
    await expect(reply).toBeHidden()
    expect(JSON.parse(mock.find('POST', '/review').at(-1)!.body)).toMatchObject({ message: 'Updated as requested', labels: { 'Code-Review': 2 } })
    await expect(win.getByRole('region', { name: 'Labels' })).toContainText('Test User +2')

    await win.getByRole('button', { name: 'Submit…' }).click()
    await win.getByRole('dialog', { name: 'Submit #101?' }).getByRole('button', { name: 'Submit' }).click()
    await expect(win.getByLabel('Status')).toHaveText('Merged')
    expect(mock.find('POST', '/a/changes/101/submit')).toHaveLength(1)
  } finally {
    await g.close()
    await mock.close()
  }
})

test('conflict: commit → push rejected → pull conflicts → resolve → continue → push', async () => {
  const fx = createRepoFixture()
  const other = path.join(fx.dir, 'other')
  fx.git(['clone', '-q', fx.remote, other], fx.dir)
  writeFileSync(path.join(other, 'README.md'), 'theirs\n')
  fx.git(['commit', '-qam', 'theirs'], other)
  fx.git(['push', '-q'], other)
  const app = await launchApp(fx.env)
  const { win } = app
  const toolbar = win.getByLabel('Toolbar')
  const banner = win.getByRole('status', { name: 'Conflicts' })
  try {
    await openRepo(app, fx.work)
    writeFileSync(path.join(fx.work, 'README.md'), 'ours\n')
    await toggle(win.getByRole('grid', { name: 'Changed files' }).getByRole('row', { name: 'README.md' }).getByRole('checkbox', { name: 'Staged' }))
    const box = win.getByRole('form', { name: 'Commit' })
    await box.getByLabel('Summary').fill('Ours')
    await box.getByRole('button', { name: 'Commit to main' }).click()
    await expect(win.getByText('No local changes')).toBeVisible()

    await toolbar.getByRole('button', { name: 'Push ↑1' }).click()
    const rejected = win.getByRole('alert').filter({ hasText: 'Remote has new commits' })
    await rejected.getByRole('button', { name: 'Pull' }).click()
    await expect(banner).toContainText('README.md')
    expect(readFileSync(path.join(fx.work, 'README.md'), 'utf8')).toContain('<<<<<<<')

    writeFileSync(path.join(fx.work, 'README.md'), 'ours and theirs\n')
    await banner.getByRole('button', { name: 'Mark resolved' }).click()
    await expect(banner).toContainText('All conflicts resolved')
    await banner.getByRole('button', { name: 'Continue merge' }).click()
    await expect(banner).toHaveCount(0)

    await toolbar.getByRole('button', { name: 'Push ↑2' }).click()
    await expect(toolbar.getByRole('button', { name: 'Fetch origin' })).toBeVisible()
    expect(execFileSync('git', ['show', 'main:README.md'], { cwd: fx.remote, env: fx.env, encoding: 'utf8' })).toBe('ours and theirs\n')
  } finally {
    await app.close()
    fx.cleanup()
  }
})

test('update: newer version in feed → pill → download (stubbed) → restart (stubbed), repo stays open', async () => {
  const fx = createRepoFixture()
  const yml = `version: 99.0.0\nfiles:\n  - url: gitdock-99.0.0.zip\n    sha512: AAAA\n    size: 1\npath: gitdock-99.0.0.zip\nsha512: AAAA\nreleaseDate: '2026-01-01T00:00:00.000Z'\nreleaseNotes: 'Faster history'\n`
  const feed = await startMockServer(Object.fromEntries(['latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'latest-linux-arm64.yml'].map((f) => [`GET /${f}`, () => ({ body: yml })])))
  const app = await launchApp({ ...fx.env, GITDOCK_E2E_UPDATE_FEED: feed.url, GITDOCK_E2E_SELF_INSTALL: '1' })
  const { win } = app
  try {
    await openRepo(app, fx.work)
    await app.app.evaluate(() => {
      const g = globalThis as unknown as { __gitdockUpdater: NodeJS.EventEmitter & Record<string, unknown>; __installed?: boolean }
      const u = g.__gitdockUpdater
      u.downloadUpdate = async () => {
        u.emit('download-progress', { percent: 50, bytesPerSecond: 1, total: 2, transferred: 1, delta: 1 })
        await new Promise((r) => setTimeout(r, 300))
        u.emit('update-downloaded', { version: '99.0.0' })
        return []
      }
      u.quitAndInstall = () => void (g.__installed = true)
    })
    // Help/App menu → Check for Updates…
    await app.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('update:check')!.click())
    await win.getByRole('button', { name: 'Update v99.0.0 available' }).click()
    await expect(win.getByRole('dialog', { name: 'gitdock 99.0.0' })).toContainText('Faster history')
    await win.getByRole('button', { name: 'Download' }).click()
    await expect(win.getByRole('progressbar', { name: 'Downloading update' })).toBeVisible()
    await win.getByRole('button', { name: 'Restart to update' }).click()
    await expect.poll(() => app.app.evaluate(() => (globalThis as { __installed?: boolean }).__installed)).toBe(true)
    await expect(win.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true')
  } finally {
    await app.close()
    await feed.close()
    fx.cleanup()
  }
})
