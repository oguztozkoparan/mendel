import { useQuery } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { useRef, useState } from 'react'
import { Button, Dialog, DialogTrigger } from 'react-aria-components'
import s from './History.module.css'
import { PopPopover } from './motion'
import r from './Repos.module.css'
import { trailerLabel, trailerRole, type Trailer } from './trailers'

type Person = Extract<Trailer, { kind: 'person' }>

/** Copies `text` and shows "Copied" on the chip for a moment. */
function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) =>
    void window.mendel['app:copy']({ text }).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  return [copied, copy] as const
}

/** Commit trailers below the body, grouped by key; unknown ones stay plain `Key: value` text. */
export function Trailers({ repo, trailers }: { repo: string; trailers: Trailer[] }) {
  const groups = new Map<string, Trailer[]>()
  for (const t of trailers.filter((t) => t.kind !== 'other')) groups.set(t.key.toLowerCase(), [...(groups.get(t.key.toLowerCase()) ?? []), t])
  const other = trailers.filter((t) => t.kind === 'other')
  const roles = (p: Person) =>
    [...new Set(trailers.filter((t) => t.kind === 'person' && (p.email ? t.email === p.email : t.name === p.name)).map((t) => trailerRole(t.key)))].join(', ')
  return (
    <div className={s.trailers} aria-label="Trailers">
      {[...groups.values()].map((g) => (
        <div key={g[0]!.key} className={s.trailerGroup}>
          <span className={s.trailerKey}>{trailerLabel(g[0]!.key)}</span>
          <div className={s.trailerChips}>
            {g.map((t, i) =>
              t.kind === 'person' ? (
                <PersonChip key={i} t={t} roles={roles(t)} />
              ) : t.kind === 'url' ? (
                <UrlChip key={i} repo={repo} url={t.value} />
              ) : (
                <CopyChip key={i} text={t.value} />
              )
            )}
          </div>
        </div>
      ))}
      {other.map((t, i) => (
        <p key={i} className={s.trailerOther}>
          {t.key}: {t.value}
        </p>
      ))}
    </div>
  )
}

function CopyChip({ text }: { text: string }) {
  const [copied, copy] = useCopy()
  return (
    <Button className={s.chip} aria-label={`${copied ? 'Copied' : 'Copy'} ${text}`} onPress={() => copy(text)}>
      <code>{text}</code>
      {copied && <span className={s.chipNote}>Copied</span>}
    </Button>
  )
}

/** Opens through gerrit:open when the URL is on the repo's configured Gerrit (main re-checks the origin); anything else is copied, never opened. */
function UrlChip({ repo, url }: { repo: string; url: string }) {
  const provider = useQuery({ queryKey: ['provider', repo], queryFn: () => window.mendel['provider:get']({ repo }) })
  const [copied, copy] = useCopy()
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return <CopyChip text={url} />
  }
  const d = provider.data?.detection
  const gerrit = d?.provider === 'gerrit' && !!d.baseUrl && new URL(d.baseUrl).origin === u.origin
  const parts = u.pathname.split('/').filter(Boolean)
  const short = u.host + (parts.length > 2 ? `/${parts[0]}/…/${parts.at(-1)}` : u.pathname.replace(/\/$/, ''))
  return (
    <Button
      className={s.chip}
      aria-label={gerrit ? `Open ${url} in browser` : `${copied ? 'Copied' : 'Copy'} ${url}`}
      onPress={() => (gerrit ? void window.mendel['gerrit:open']({ repo, path: u.href }) : copy(url))}
    >
      <span title={`${url}\n${gerrit ? 'Click to open' : 'Click to copy'}`}>{short}</span>
      {copied && <span className={s.chipNote}>Copied</span>}
    </Button>
  )
}

/** Person chip: hovering (after a delay) shows the card without taking focus; a press or Enter opens it as a dialog. */
function PersonChip({ t, roles }: { t: Person; roles: string }) {
  const [open, setOpen] = useState<false | 'hover' | 'press'>(false)
  const [copied, copy] = useCopy()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pressedWhileHover = useRef(false)
  const later = (f: () => void, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(f, ms)
  }
  const closeHover = () => later(() => setOpen((o) => (o === 'hover' ? false : o)), 200)
  return (
    <DialogTrigger
      isOpen={!!open}
      onOpenChange={(o) => {
        clearTimeout(timer.current)
        // A press on a hover-opened card pins it open instead of toggling it shut.
        if (!o && pressedWhileHover.current) setOpen('press')
        else setOpen(o ? 'press' : false)
        pressedWhileHover.current = false
      }}
    >
      <Button
        className={s.chip}
        aria-label={`${t.name}, ${trailerRole(t.key)}`}
        onHoverStart={() => later(() => setOpen((o) => o || 'hover'), 500)}
        onHoverEnd={() => (open ? closeHover() : clearTimeout(timer.current))}
        onPressStart={() => (pressedWhileHover.current = open === 'hover')}
      >
        <span className={s.avatar} aria-hidden>
          {t.name.trim().charAt(0).toUpperCase()}
        </span>
        {t.name}
      </Button>
      <AnimatePresence>
        {open && (
          <PopPopover placement="bottom start" className={r.popover} isNonModal={open === 'hover'}>
            <Dialog aria-label={t.name} className={s.personDialog}>
              <div className={`${r.menu} ${s.person}`} onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={() => open === 'hover' && closeHover()}>
                <strong>{t.name}</strong>
                <span className={s.personEmail}>{t.email ?? 'No email'}</span>
                <span className={s.personRoles}>{roles}</span>
                {t.email && (
                  <Button className={s.personCopy} onPress={() => copy(t.email!)}>
                    {copied ? 'Copied' : 'Copy email'}
                  </Button>
                )}
              </div>
            </Dialog>
          </PopPopover>
        )}
      </AnimatePresence>
    </DialogTrigger>
  )
}
