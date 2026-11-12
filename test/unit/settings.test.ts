import { describe, expect, it } from 'vitest'
import { DEFAULTS, parseSettings, parseWindowState } from '../../src/main/settings'

describe('settings file validation', () => {
  it('missing or garbage -> defaults', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULTS)
    expect(parseSettings('nope')).toEqual(DEFAULTS)
  })
  it('keeps valid fields, resets only invalid ones, drops unknown keys', () => {
    expect(parseSettings({ theme: 'dark', autoFetchMinutes: 7, summaryLimit: 50, pullStrategy: 'octopus', extra: 1 })).toEqual({
      ...DEFAULTS,
      theme: 'dark',
      summaryLimit: 50
    })
  })
  it('accepts Vesper and Lauds; an unknown theme falls back to the default', () => {
    expect(parseSettings({ theme: 'vesper' }).theme).toBe('vesper')
    expect(parseSettings({ theme: 'lauds' }).theme).toBe('lauds')
    expect(parseSettings({ theme: 'sepia' }).theme).toBe(DEFAULTS.theme)
  })
  it('window state needs finite numbers', () => {
    expect(parseWindowState({ window: { x: 1, y: 2, width: 3, height: 4, maximized: true } })).toEqual({ x: 1, y: 2, width: 3, height: 4, maximized: true })
    expect(parseWindowState({ window: { x: 'a', y: 2, width: 3, height: 4 } })).toBeNull()
    expect(parseWindowState(null)).toBeNull()
  })
})
