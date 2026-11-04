// Preferences + window state in userData/settings.json (TECH.md §3: tiny JSON, validated on load, atomic write).
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { settingsFields, type Settings } from '../shared/ipc'
import log from './log'

export const DEFAULTS: Settings = {
  theme: 'system',
  reopenLastRepo: true,
  confirmDiscard: true,
  autoFetchMinutes: 15,
  pullStrategy: 'merge',
  summaryLimit: 72,
  spellcheck: true,
  descriptionRuler: false,
  showWhitespace: false,
  autoUpdateCheck: true,
  reviewsRefreshMinutes: 5,
  editor: 'system',
  editorPath: '',
  terminal: 'system',
  terminalPath: ''
}

/** Main-only state stored next to the preferences. */
export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

/** Keep each valid field, fall back to the default for invalid or missing ones (a bad value never resets the rest). */
export function parseSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const r = settingsFields[k].safeParse(o[k])
    out[k] = r.success ? r.data : DEFAULTS[k]
  }
  return out as Settings
}

export function parseWindowState(raw: unknown): WindowState | null {
  const w = (raw as { window?: Partial<WindowState> } | null)?.window
  if (!w || ![w.x, w.y, w.width, w.height].every((n) => Number.isFinite(n))) return null
  return { x: w.x!, y: w.y!, width: w.width!, height: w.height!, maximized: w.maximized === true }
}

let store: { prefs: Settings; window: WindowState | null } | undefined
const file = () => path.join(app.getPath('userData'), 'settings.json')

function load(): NonNullable<typeof store> {
  if (store) return store
  let raw: unknown = {}
  try {
    raw = JSON.parse(readFileSync(file(), 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('[settings] unreadable, using defaults', err)
  }
  store = { prefs: parseSettings(raw), window: parseWindowState(raw) }
  return store
}

function save(): void {
  const s = load()
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify({ ...s.prefs, window: s.window }, null, 2), { mode: 0o600 }) // owner-only (S9)
  renameSync(tmp, file())
}

export const getSettings = (): Settings => load().prefs

const listeners: ((s: Settings) => void)[] = []
/** Called after every change (e.g. theme). */
export function onSettingsChanged(fn: (s: Settings) => void): void {
  listeners.push(fn)
}

export function setSettings(patch: Partial<Settings>): Settings {
  const s = load()
  s.prefs = parseSettings({ ...s.prefs, ...patch })
  save()
  for (const fn of listeners) fn(s.prefs)
  return s.prefs
}

export const getWindowState = (): WindowState | null => load().window

export function setWindowState(w: WindowState): void {
  load().window = w
  save()
}
