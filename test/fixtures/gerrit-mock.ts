// Mock Gerrit 3.1 REST server (TECH.md §5) on startMockServer: realistic JSON shapes, `)]}'` prefix,
// Basic auth on /a/ (401 on wrong password), mutable state and request recording for assertions.
import { startMockServer, type MockRequest, type MockResponse, type MockServer } from './mock-server'

type Json = any

export const SELF = { _account_id: 1000, name: 'Test User', email: 'test@example.com', username: 'test' }
export const OTHER = { _account_id: 1001, name: 'Ada Reviewer', email: 'ada@example.com', username: 'ada' }

const ts = (d: string) => `${d} 10:00:00.000000000`
const CR_VALUES = { '-2': 'This shall not be submitted', '-1': 'I would prefer this is not submitted as is', ' 0': 'No score', '+1': 'Looks good to me, but someone else must approve', '+2': 'Looks good to me, approved' }
const V_VALUES = { '-1': 'Fails', ' 0': 'No score', '+1': 'Verified' }
const sha = (c: string) => c.repeat(40)

/** Per revision: file list (FileInfo map incl. /COMMIT_MSG) and diff content blocks per path. */
export interface MockFile {
  status?: 'A' | 'D' | 'R' | 'M'
  lines_inserted?: number
  lines_deleted?: number
  /** DiffInfo.content blocks: `{ab}` / `{a,b}` / `{a}` / `{b}` (/ `{skip}`). */
  diff: Json[]
}

/** A change as stored by the mock: ChangeInfo (3.1 shape) plus mock-only `files`, `comments`, `rebaseConflict`. */
export interface MockChange {
  _number: number
  [k: string]: Json
  /** revision sha → path → file. */
  files: Record<string, Record<string, MockFile>>
  /** path → CommentInfo[] (with `patch_set`). */
  comments: Record<string, Json[]>
  /** POST /rebase answers 409 like a real merge conflict. */
  rebaseConflict?: boolean
}

function commitMsg(subject: string, number: number): MockFile {
  const lines = ['Parent:     0000000a (initial commit)', 'Author:     Test User <test@example.com>', 'AuthorDate: 2026-11-01 10:00:00 +0000', 'Commit:     Test User <test@example.com>', 'CommitDate: 2026-11-01 10:00:00 +0000', '', subject, '', `Change-Id: I${String(number).padStart(40, '0')}`]
  return { status: 'A', lines_inserted: lines.length, diff: [{ b: lines }] }
}

/** Default data: #101 outgoing (p/q, 2 patchsets, comments, all actions), #102 + #103 incoming, #90 merged. */
export function defaultChanges(): MockChange[] {
  const files101 = (subject: string): Record<string, MockFile> => ({
    '/COMMIT_MSG': commitMsg(subject, 101),
    'src/a.ts': { lines_inserted: 2, lines_deleted: 1, diff: [{ ab: ['export const a = 1'] }, { a: ['export const b = 2'], b: ['export const bb = 2', 'export const c = 3'] }, { ab: ['// end'] }] },
    'docs/new.md': { status: 'A', lines_inserted: 1, diff: [{ b: ['# New doc'] }] }
  })
  const change = (n: number, extra: Json): MockChange => ({
    id: `${encodeURIComponent(extra.project)}~${extra.branch ?? 'main'}~I${String(n).padStart(40, '0')}`,
    branch: 'main',
    change_id: `I${String(n).padStart(40, '0')}`,
    status: 'NEW',
    created: ts('2026-11-01'),
    updated: ts('2026-11-03'),
    mergeable: true,
    insertions: 3,
    deletions: 1,
    unresolved_comment_count: 0,
    _number: n,
    messages: [],
    files: {},
    comments: {},
    ...extra
  })
  return [
    change(101, {
      project: 'p/q',
      topic: 'feature-x',
      subject: 'Add feature X',
      owner: SELF,
      unresolved_comment_count: 1,
      labels: {
        'Code-Review': { disliked: OTHER, all: [{ ...OTHER, value: -1 }, { ...SELF, value: 0 }], values: CR_VALUES, default_value: 0 },
        Verified: { approved: OTHER, all: [{ ...OTHER, value: 1 }], values: V_VALUES, default_value: 0 }
      },
      permitted_labels: { 'Code-Review': ['-2', '-1', ' 0', '+1', '+2'], Verified: ['-1', ' 0', '+1'] },
      reviewers: { REVIEWER: [OTHER, SELF] },
      current_revision: sha('b'),
      revisions: {
        [sha('a')]: { kind: 'REWORK', _number: 1, created: ts('2026-11-01'), uploader: SELF, ref: 'refs/changes/01/101/1', commit: { subject: 'Add feature X' } },
        [sha('b')]: {
          kind: 'REWORK',
          _number: 2,
          created: ts('2026-11-02'),
          uploader: SELF,
          ref: 'refs/changes/01/101/2',
          commit: { subject: 'Add feature X' },
          actions: {
            submit: { method: 'POST', label: 'Submit', title: 'Submit patch set 2 into main', enabled: true },
            rebase: { method: 'POST', label: 'Rebase', title: 'Rebase onto tip of branch or parent change', enabled: true },
            cherrypick: { method: 'POST', label: 'Cherry Pick', title: 'Cherry pick change to a different branch', enabled: true }
          }
        }
      },
      actions: {
        abandon: { method: 'POST', label: 'Abandon', title: 'Abandon the change', enabled: true },
        topic: { method: 'PUT', label: 'Edit Topic', enabled: true }
      },
      messages: [
        { id: 'm1', author: SELF, real_author: SELF, date: ts('2026-11-01'), message: 'Uploaded patch set 1.', _revision_number: 1 },
        { id: 'm2', author: OTHER, real_author: OTHER, date: ts('2026-11-02'), message: 'Patch Set 1: Code-Review-1\n\n(1 comment)', _revision_number: 1 },
        { id: 'm3', author: SELF, real_author: SELF, date: ts('2026-11-02'), message: 'Uploaded patch set 2.', _revision_number: 2 }
      ],
      files: { [sha('a')]: files101('Add feature X'), [sha('b')]: files101('Add feature X') },
      comments: {
        'src/a.ts': [
          { id: 'c1', author: OTHER, patch_set: 2, line: 2, message: 'Please **rename** this. See [docs](https://example.com/docs)', updated: ts('2026-11-02'), unresolved: true },
          { id: 'c2', in_reply_to: 'c1', author: SELF, patch_set: 2, line: 2, message: 'Which name?', updated: ts('2026-11-03'), unresolved: true },
          { id: 'c3', author: OTHER, patch_set: 2, line: 1, side: 'PARENT', message: 'Old side note', updated: ts('2026-11-02'), unresolved: false }
        ]
      }
    }),
    change(102, {
      project: 'other/r',
      subject: 'Fix crash in parser',
      owner: OTHER,
      labels: { 'Code-Review': { all: [], values: CR_VALUES, default_value: 0 } },
      permitted_labels: { 'Code-Review': ['-1', ' 0', '+1'] },
      reviewers: { REVIEWER: [SELF] },
      current_revision: sha('c'),
      revisions: { [sha('c')]: { _number: 1, created: ts('2026-11-02'), uploader: OTHER, ref: 'refs/changes/02/102/1', commit: { subject: 'Fix crash in parser' }, actions: {} } },
      actions: {},
      files: { [sha('c')]: { '/COMMIT_MSG': commitMsg('Fix crash in parser', 102) } }
    }),
    change(103, {
      project: 'p/q',
      subject: 'Draft: refactor',
      owner: OTHER,
      work_in_progress: true,
      labels: {},
      permitted_labels: {},
      reviewers: { REVIEWER: [SELF] },
      current_revision: sha('d'),
      revisions: { [sha('d')]: { _number: 1, created: ts('2026-11-02'), uploader: OTHER, ref: 'refs/changes/03/103/1', commit: { subject: 'Draft: refactor' }, actions: {} } },
      actions: {},
      files: { [sha('d')]: { '/COMMIT_MSG': commitMsg('Draft: refactor', 103) } }
    }),
    change(90, {
      project: 'p/q',
      subject: 'Initial import',
      owner: SELF,
      status: 'MERGED',
      submitted: ts('2026-10-01'),
      labels: { 'Code-Review': { approved: OTHER, all: [{ ...OTHER, value: 2 }], values: CR_VALUES, default_value: 0 } },
      permitted_labels: {},
      reviewers: { REVIEWER: [OTHER] },
      current_revision: sha('e'),
      revisions: { [sha('e')]: { _number: 1, created: ts('2026-10-01'), uploader: SELF, ref: 'refs/changes/90/90/1', commit: { subject: 'Initial import' }, actions: {} } },
      actions: {},
      files: { [sha('e')]: { '/COMMIT_MSG': commitMsg('Initial import', 90) } }
    })
  ]
}

export interface GerritMockOptions {
  username?: string
  /** HTTP password (or token) the mock accepts. */
  password?: string
  version?: string
  changes?: MockChange[]
}

/** Return undefined to fall through to the next intercept / built-in route. */
type Handler = (req: MockRequest, m: RegExpExecArray) => MockResponse | undefined | Promise<MockResponse | undefined>

export interface GerritMock extends MockServer {
  username: string
  password: string
  /** Mutable server state; tests may edit it between requests. */
  changes: MockChange[]
  /** Answer requests matching `METHOD` + pathname regex with `handler` before the built-in routes (latest first; undefined = fall through). */
  intercept(method: string, path: RegExp, handler: Handler): void
  /** Recorded requests whose method matches and whose url contains `part`. */
  find(method: string, part: string): MockRequest[]
}

export const json = (body: unknown, status = 200): MockResponse => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: ")]}'\n" + JSON.stringify(body)
})
const text = (status: number, body: string): MockResponse => ({ status, headers: { 'content-type': 'text/plain; charset=utf-8' }, body })

/** Start the mock; base URL = `mock.url` (http on loopback, allowed only in unpackaged/test builds). */
export async function startGerritMock(opts: GerritMockOptions = {}): Promise<GerritMock> {
  const username = opts.username ?? SELF.username
  const password = opts.password ?? 'http-pass'
  const changes = opts.changes ?? defaultChanges()
  const intercepts: { method: string; path: RegExp; handler: Handler }[] = []
  let nextId = 1

  const find = (id: string) => changes.find((c) => String(c._number) === id || c.id === id)
  const revOf = (c: MockChange, rev: string) =>
    rev === 'current' ? c.current_revision : Object.keys(c.revisions).find((s) => s === rev || String(c.revisions[s]._number) === rev)
  const summary = (c: MockChange) => {
    const { files: _f, comments: _c, rebaseConflict: _r, messages: _m, revisions, ...rest } = c
    return { ...rest, revisions: { [c.current_revision]: revisions[c.current_revision] } }
  }
  const detail = (c: MockChange) => {
    const { files: _f, comments: _c, rebaseConflict: _r, ...rest } = c
    return rest
  }
  const query = (q: string) => {
    const project = /project:"?([^"\s]+)"?/.exec(q)?.[1]
    return changes.filter((c) => {
      if (project && c.project !== project) return false
      const ids = [...q.matchAll(/change:(I[0-9a-f]{40})/g)].map((m) => m[1])
      if (ids.length) return c.status === 'NEW' && ids.includes(c.change_id)
      if (q.includes('-is:open')) return c.owner._account_id === SELF._account_id && c.status !== 'NEW'
      if (q.includes('reviewer:self')) return c.status === 'NEW' && c.owner._account_id !== SELF._account_id && (c.reviewers?.REVIEWER ?? []).some((r: Json) => r._account_id === SELF._account_id)
      if (q.includes('owner:self')) return c.status === 'NEW' && c.owner._account_id === SELF._account_id
      return true
    })
  }

  async function route(req: MockRequest): Promise<MockResponse> {
    const u = new URL(req.url, 'http://x')
    for (const i of intercepts) {
      const m = i.method === req.method ? i.path.exec(u.pathname) : null
      const out = m && (await i.handler(req, m))
      if (out) return out
    }
    if (req.method === 'GET' && u.pathname === '/config/server/version') return json(opts.version ?? '3.1.3')
    if (!u.pathname.startsWith('/a/')) return text(404, 'Not found')
    const auth = req.headers.authorization ?? ''
    if (auth !== 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')) return text(401, 'Unauthorized')

    const path = u.pathname.slice(3) // after /a/
    if (req.method === 'GET' && path === 'accounts/self') return json(SELF)
    if (req.method === 'GET' && path === 'changes/') {
      const qs = u.searchParams.getAll('q')
      // Without DETAILED_LABELS Gerrit sends no per-reviewer votes (`all`) or value descriptions.
      const detailed = u.searchParams.getAll('o').includes('DETAILED_LABELS')
      const labelsOnly = (c: Json) => (detailed ? c : { ...c, labels: Object.fromEntries(Object.entries<Json>(c.labels ?? {}).map(([k, { all: _a, values: _v, ...l }]) => [k, l])) })
      const results = qs.map((q) => query(q).map(summary).map(labelsOnly))
      return json(qs.length === 1 ? results[0] : results)
    }
    // changes/<id>[/revisions/<rev>]/<rest>, segments URL-encoded (paths use %2F)
    const m = /^changes\/([^/]+)(?:\/revisions\/([^/]+))?\/(.+)$/.exec(path)
    const c = m ? find(decodeURIComponent(m[1])) : undefined
    if (!m || !c) return text(404, `Not found: ${m ? decodeURIComponent(m[1]) : path}`)
    const rev = m[2] ? revOf(c, decodeURIComponent(m[2])) : undefined
    if (m[2] && !rev) return text(404, 'Not found')
    const rest = m[3]
    const body = req.body ? JSON.parse(req.body) : {}
    const key = `${req.method} ${m[2] ? 'rev/' : ''}${rest.replace(/^files\/[^/]+\/diff$/, 'files/:path/diff')}`
    switch (key) {
      case 'GET detail':
        return json(detail(c))
      case 'GET comments':
        return json(c.comments)
      case 'GET rev/files': {
        const fs = Object.fromEntries(Object.entries(c.files[rev!] ?? {}).map(([p, f]) => [p, { status: f.status, lines_inserted: f.lines_inserted, lines_deleted: f.lines_deleted, size_delta: 0, size: 100 }]))
        return json(fs)
      }
      case 'GET rev/files/:path/diff': {
        const name = decodeURIComponent(rest.split('/')[1])
        const f = c.files[rev!]?.[name]
        if (!f) return text(404, 'Not found')
        const meta = { name, content_type: 'text/plain', lines: 10 }
        return json({ meta_a: f.status === 'A' ? undefined : meta, meta_b: f.status === 'D' ? undefined : meta, change_type: { A: 'ADDED', D: 'DELETED', R: 'RENAMED', M: 'MODIFIED' }[f.status ?? 'M'], diff_header: [], content: f.diff })
      }
      case 'POST rev/review': {
        const ps = c.revisions[rev!]._number
        for (const [label, value] of Object.entries<number>(body.labels ?? {})) {
          if (!c.permitted_labels?.[label]?.some((v: string) => Number(v) === value)) return text(400, `Applying label "${label}": ${value} is restricted`)
          const l = (c.labels[label] ??= { all: [], values: {} })
          l.all = [...l.all.filter((v: Json) => v._account_id !== SELF._account_id), { ...SELF, value }]
        }
        for (const [p, list] of Object.entries<Json[]>(body.comments ?? {}))
          for (const cm of list) (c.comments[p] ??= []).push({ ...cm, id: `new${nextId++}`, author: SELF, patch_set: ps, updated: ts('2026-11-04') })
        if (body.message) c.messages.push({ id: `msg${nextId++}`, author: SELF, date: ts('2026-11-04'), message: `Patch Set ${ps}:\n\n${body.message}`, _revision_number: ps })
        return json({ labels: body.labels ?? {} })
      }
      case 'POST submit':
        c.status = 'MERGED'
        c.actions = {}
        c.revisions[c.current_revision].actions = {}
        return json(summary(c))
      case 'POST abandon':
        c.status = 'ABANDONED'
        c.actions = { restore: { method: 'POST', label: 'Restore', enabled: true } }
        c.revisions[c.current_revision].actions = {}
        if (body.message) c.messages.push({ id: `msg${nextId++}`, author: SELF, date: ts('2026-11-04'), message: `Abandoned\n\n${body.message}` })
        return json(summary(c))
      case 'POST rebase':
        if (c.rebaseConflict) return text(409, 'The change could not be rebased due to a conflict during merge.')
        return json(summary(c))
    }
    return text(404, 'Not found')
  }

  const server = await startMockServer({ '*': route })
  return {
    ...server,
    username,
    password,
    changes,
    intercept: (method, path, handler) => void intercepts.unshift({ method, path, handler }),
    find: (method, part) => server.requests.filter((r) => r.method === method && decodeURIComponent(r.url).includes(part))
  }
}
