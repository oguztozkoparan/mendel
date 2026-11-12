import { useContext, useEffect, useRef, useState, type ContextType, type RefObject } from 'react'
import { Tooltip, TooltipTrigger, TooltipTriggerStateContext } from 'react-aria-components'

type Tip = { el: HTMLElement; text: string }
type State = NonNullable<ContextType<typeof TooltipTriggerStateContext>>

const truncated = (el: Element) => getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth

/**
 * What an element shows: an icon-only button its name, an element with `data-tip` that text, a text cut off by an
 * ellipsis its full value (measured now). A native `title` on the way up stays the only tooltip. Focus only looks at
 * the focused button itself and its descendants.
 */
function tipFor(target: Element, focused: boolean): Tip | null {
  if (target.closest('[title]')) return null
  const button = target.closest<HTMLElement>('button, [role="button"]')
  const name = button?.getAttribute('aria-label')
  if (button && name && !button.textContent?.trim()) return { el: button, text: name }
  const scope = !focused ? null : button === target ? [button, ...button.querySelectorAll<HTMLElement>('*')] : []
  const own = scope ? scope.find((e) => e.dataset.tip) : target.closest<HTMLElement>('[data-tip]')
  if (own?.dataset.tip) return { el: own, text: own.dataset.tip }
  let el: HTMLElement | null | undefined
  if (scope) el = scope.find(truncated)
  else for (el = target as HTMLElement; el && el !== document.body && !truncated(el); el = el.parentElement);
  return el && el !== document.body ? { el, text: el.innerText } : null
}

/**
 * The app's one tooltip, mounted once (explicit text: `data-tip="…"` on any element). Delegated document listeners find the element under the pointer (or the
 * keyboard-focused button), so list rows carry no tooltip state and nothing is measured before a hover or focus.
 * react-aria's TooltipTrigger supplies the open state and warm-up delay; its trigger props stay unused, so the tooltip
 * never becomes an aria-describedby duplicate of an icon button's name (a truncated text is already in the DOM in full).
 */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const state = useRef<State | null>(null)
  useEffect(() => {
    let cur: HTMLElement | null = null
    let focused: HTMLElement | null = null // the tip opened by keyboard focus; only its blur hides it
    const show = (t: Tip | null, immediate = false) => {
      if ((t?.el ?? null) === cur) return
      cur = t?.el ?? null
      if (!t) return state.current?.close(true)
      setTip(t)
      state.current?.open(immediate)
    }
    const hide = () => state.current?.close(true)
    // a pressed pointer (drag, text selection) or a finger: no tooltip
    const over = (e: PointerEvent) => e.target instanceof Element && !e.buttons && e.pointerType !== 'touch' && show(tipFor(e.target, false))
    const out = (e: PointerEvent) => !e.relatedTarget && show(null)
    const focus = (e: FocusEvent) => {
      const t = e.target instanceof Element && e.target.matches(':focus-visible') ? tipFor(e.target, true) : null
      if (t) show(t, true)
      focused = t?.el ?? null
    }
    // an unrelated focus change (a list refetch, a dialog restoring focus) leaves a hover tooltip alone
    const blur = () => (focused && focused === cur && show(null), (focused = null))
    const on = [
      ['pointerover', over],
      ['pointerout', out],
      ['pointerdown', hide],
      ['keydown', hide],
      ['focusin', focus],
      ['focusout', blur]
    ] as const
    for (const [k, f] of on) document.addEventListener(k, f as EventListener, true)
    return () => on.forEach(([k, f]) => document.removeEventListener(k, f as EventListener, true))
  }, [])
  return (
    <TooltipTrigger delay={600} closeDelay={0}>
      <Grab into={state} />
      {/* data-react-aria-top-layer: an open dialog's aria-hidden sweep leaves the tooltip readable */}
      <Tooltip triggerRef={{ current: tip?.el ?? null }} className="tooltip" offset={6} containerPadding={8} data-react-aria-top-layer>
        {tip?.text}
      </Tooltip>
    </TooltipTrigger>
  )
}

/** Hands TooltipTrigger's state to the document listeners. */
function Grab({ into }: { into: RefObject<State | null> }) {
  into.current = useContext(TooltipTriggerStateContext)
  return null
}
