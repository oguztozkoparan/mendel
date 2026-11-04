import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchApp } from './launch'

test('welcome asks "Who are you?" when user.name/user.email are unset and writes the global config', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gitdock-id-'))
  const gitconfig = path.join(dir, 'gitconfig')
  writeFileSync(gitconfig, '[user]\n\tname = Half Set\n') // email missing
  const l = await launchApp({ GIT_CONFIG_GLOBAL: gitconfig })
  const { win } = l
  const get = (k: string) => execFileSync('git', ['config', '--file', gitconfig, k], { encoding: 'utf8' }).trim()
  try {
    const form = win.getByRole('form', { name: 'Who are you?' })
    await expect(form.getByLabel('Name')).toHaveValue('Half Set')
    await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled()
    await form.getByLabel('Email').fill('me@example.com')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form).toHaveCount(0)
    expect([get('user.name'), get('user.email')]).toEqual(['Half Set', 'me@example.com'])
  } finally {
    await l.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no identity form when both are set', async () => {
  const l = await launchApp()
  try {
    await expect(l.win.getByRole('button', { name: 'Open local repository…' })).toBeVisible()
    expect(await l.win.evaluate(() => window.gitdock['settings:gitIdentity']())).toEqual({ name: 'Test User', email: 'test@example.com' })
    await expect(l.win.getByRole('form', { name: 'Who are you?' })).toHaveCount(0)
  } finally {
    await l.close()
  }
})
