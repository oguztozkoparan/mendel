import { useQuery } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { Button, Dialog, DialogTrigger } from 'react-aria-components'
import { onGithub } from '../../shared/github'
import c from './Changes.module.css'
import s from './History.module.css'
import { Markdown } from './Markdown'
import md from './Markdown.module.css'
import { PopPopover } from './motion'
import r from './Repos.module.css'
import { splitTrailers, trailerLabel, trailerRole, type Trailer } from './trailers'

type Person = Extract<Trailer, { kind: 'person' }>

/** Copies `text` and shows "Copied" on the chip for a moment. */
export function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) =>
    void window.mendel['app:copy']({ text }).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  return [copied, copy] as const
}

/**
 * Commit message body (message without its summary line) as Markdown in a capped, focusable region, then its trailers;
 * nothing when both are empty. Line breaks are kept and HTML-looking text stays literal: most messages are plain text.
 */
export function CommitBody({ repo, body, label }: { repo: string; body: string; label: string }) {
  const { text, trailers } = splitTrailers(body)
  return (
    <>
      {text && (
        <div className={`${s.message} ${c.capText} ${md.markdown} ${md.lines}`} role="region" aria-label={label} tabIndex={0}>
          <Markdown text={text} gfm htmlAsText link={({ href, children }) => <CommitLink repo={repo} href={href}>{children}</CommitLink>} />
        </div>
      )}
      {trailers.length > 0 && <Trailers repo={repo} trailers={trailers} />}
    </>
  )
}

/**
 * How a URL in a commit is activated: opened by main when it is on the repo's own provider (configured Gerrit origin, or
 * github.com for a GitHub repo; main checks again), otherwise null = copied, never opened.
 */
function useUrlOpener(repo: string) {
  const d = useQuery({ queryKey: ['provider', repo], queryFn: () => window.mendel['provider:get']({ repo }) }).data?.detection
  return (u: URL): (() => void) | null => {
    if (d?.provider === 'gerrit' && d.baseUrl && new URL(d.baseUrl).origin === u.origin) return () => void window.mendel['gerrit:open']({ repo, path: u.href })
    if (d?.provider === 'github' && onGithub(u)) return () => void window.mendel['github:openLink']({ repo, href: u.href })
    return null
  }
}

/** A link in a commit message. Only absolute web and mail URLs are links; relative ones, '#…' and dropped unsafe schemes stay text. */
function CommitLink({ repo, href, children }: { repo: string; href?: string; children?: ReactNode }) {
  const opener = useUrlOpener(repo)
  const [copied, copy] = useCopy()
  const u = href && URL.canParse(href) ? new URL(href) : null
  if (!u || !['https:', 'http:', 'mailto:'].includes(u.protocol)) return <>{children}</>
  const open = opener(u)
  return (
    <>
      <a
        href={u.href}
        data-tip={`${u.href}\n${open ? 'Click to open' : 'Click to copy'}`}
        onClick={(e) => {
          e.preventDefault()
          if (open) open()
          else copy(u.href)
        }}
      >
        {children}
      </a>
      {copied && (
        <span role="status" className={s.chipNote}>
          Copied
        </span>
      )}
    </>
  )
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

/** Opens through main when the URL is on the repo's own provider (useUrlOpener); anything else is copied, never opened. */
function UrlChip({ repo, url }: { repo: string; url: string }) {
  const opener = useUrlOpener(repo)
  const [copied, copy] = useCopy()
  if (!URL.canParse(url)) return <CopyChip text={url} />
  const u = new URL(url)
  const open = opener(u)
  const parts = u.pathname.split('/').filter(Boolean)
  const short = u.host + (parts.length > 2 ? `/${parts[0]}/…/${parts.at(-1)}` : u.pathname.replace(/\/$/, ''))
  return (
    <Button className={s.chip} aria-label={open ? `Open ${url} in browser` : `${copied ? 'Copied' : 'Copy'} ${url}`} onPress={() => (open ? open() : copy(url))}>
      <span data-tip={`${url}\n${open ? 'Click to open' : 'Click to copy'}`}>{short}</span>
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
        <span>{t.name}</span>
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
