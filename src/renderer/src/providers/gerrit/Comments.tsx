import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import type { GerritComment, GerritDraft } from '../../../../shared/gerrit'
import s from './Gerrit.module.css'
import { Markdown } from './Markdown'
import { shortDate, who } from './util'

export type Pending = GerritDraft & { key: string }
export interface PendingStore {
  list: Pending[]
  add(d: GerritDraft): void
  remove(key: string): void
  clear(): void
}

/** Pending (unsent) inline comments per change; kept in localStorage so they survive a restart (PLAN.md §4.5). */
export function usePending(repo: string, change: number): PendingStore {
  const storageKey = `gitdock.gerrit.pending.${repo}.${change}`
  const [list, setList] = useState<Pending[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as Pending[]
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      if (list.length) localStorage.setItem(storageKey, JSON.stringify(list))
      else localStorage.removeItem(storageKey)
    } catch {
      /* storage unavailable: pending stays in memory */
    }
  }, [list, storageKey])
  return {
    list,
    add: (d) => setList((l) => [...l, { ...d, key: crypto.randomUUID() }]),
    remove: (key) => setList((l) => l.filter((p) => p.key !== key)),
    clear: () => setList([])
  }
}

export function Composer(p: { label: string; onSave(text: string): void; onCancel(): void }) {
  const [text, setText] = useState('')
  return (
    <div className={s.composer}>
      <textarea aria-label={p.label} autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <div className={s.threadActions}>
        <Button onPress={p.onCancel}>Cancel</Button>
        <Button className="primary" isDisabled={!text.trim()} onPress={() => p.onSave(text.trim())}>
          Save draft
        </Button>
      </div>
    </div>
  )
}

export function DraftView({ draft, onRemove }: { draft: Pending; onRemove(): void }) {
  return (
    <div role="group" aria-label="Draft comment" className={s.comment} data-draft>
      <div className={s.commentHead}>
        <strong>Draft</strong>
        <span className={s.meta}>{draft.unresolved ? 'unresolved' : 'resolves thread'}</span>
        <span className={s.grow} />
        <Button onPress={onRemove}>Discard</Button>
      </div>
      <p className={s.plain}>{draft.message}</p>
    </div>
  )
}

/** One thread (root + replies via in_reply_to): author, time, resolved state; Reply / Done / Ack add pending replies. */
export function Thread(p: { repo: string; thread: GerritComment[]; fallbackPs: number; pending: PendingStore }) {
  const [replying, setReplying] = useState(false)
  const root = p.thread[0]
  const last = p.thread.at(-1)!
  const unresolved = !!last.unresolved
  const drafts = p.pending.list.filter((d) => p.thread.some((c) => c.id === d.in_reply_to))
  const reply = (message: string, stillUnresolved: boolean) =>
    p.pending.add({ path: root.path, patch_set: root.patch_set ?? p.fallbackPs, line: root.line, side: root.side, in_reply_to: last.id, message, unresolved: stillUnresolved })
  return (
    <div role="group" aria-label={`Comment thread by ${who(root.author)}`} className={s.thread} data-unresolved={unresolved || undefined}>
      {p.thread.map((c) => (
        <div key={c.id} className={s.comment}>
          <div className={s.commentHead}>
            <strong>{who(c.author)}</strong>
            <span className={s.meta}>{shortDate(c.updated)}</span>
          </div>
          <Markdown repo={p.repo} text={c.message ?? ''} />
        </div>
      ))}
      {drafts.map((d) => (
        <DraftView key={d.key} draft={d} onRemove={() => p.pending.remove(d.key)} />
      ))}
      <div className={s.threadActions}>
        <span className={s.meta}>{unresolved ? 'Unresolved' : 'Resolved'}</span>
        <span className={s.grow} />
        <Button onPress={() => setReplying(true)}>Reply</Button>
        <Button onPress={() => reply('Done', false)}>Done</Button>
        <Button onPress={() => reply('Ack', false)}>Ack</Button>
      </div>
      {replying && <Composer label="Reply" onCancel={() => setReplying(false)} onSave={(t) => (reply(t, unresolved), setReplying(false))} />}
    </div>
  )
}
