import { animate, motion, stagger, useIsPresent, useReducedMotion, type HTMLMotionProps, type Transition } from 'motion/react'
import type { ReactNode } from 'react'
import { Modal, ModalOverlay, Popover, type ModalOverlayProps, type PopoverProps } from 'react-aria-components'

/** Springs from the UI concept's "Hareket" section. */
export const SP = {
  snap: { type: 'spring', stiffness: 520, damping: 40 },
  pop: { type: 'spring', stiffness: 460, damping: 22 },
  menu: { type: 'spring', stiffness: 480, damping: 30 },
  release: { type: 'spring', stiffness: 700, damping: 14 }
} satisfies Record<string, Transition>
const EASE = [0.2, 0.8, 0.2, 1] as const
const instant: Transition = { duration: 0 }

// MotionConfig reducedMotion="user" only drops transform/layout animations; opacity would still fade, so every
// transition here also goes instant under reduced motion.
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Sliding selection plate (tab, list row, menu item): render it inside the selected item only; same `id` per group. */
export function Highlight({ id }: { id: string }) {
  const rm = useReducedMotion()
  return <motion.span layoutId={id} className="hl" aria-hidden transition={rm ? instant : SP.snap} />
}

/** Segmented thumb at x = button.offsetLeft (offsetLeft already includes the rail padding). */
export function Thumb({ x, w }: { x: number; w: number }) {
  const rm = useReducedMotion()
  return <motion.span className="thumb" aria-hidden initial={false} animate={{ x, width: w }} transition={rm ? instant : SP.snap} />
}

const MOverlay = motion.create(ModalOverlay)
const MModal = motion.create(Modal)
const MPopover = motion.create(Popover)

/** ModalOverlay + Modal that pop in and fade out; the caller wraps the conditional render in <AnimatePresence>. */
export function DialogShell({ children, ...p }: Pick<ModalOverlayProps, 'className' | 'isDismissable' | 'onOpenChange'> & { children: ReactNode }) {
  const rm = useReducedMotion()
  const present = useIsPresent()
  return (
    <MOverlay
      {...p}
      isOpen
      style={present ? undefined : { pointerEvents: 'none' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: rm ? instant : { duration: 0.18, delay: 0.04 } }}
      transition={rm ? instant : { duration: 0.18 }}
    >
      <MModal
        initial={{ opacity: 0, scale: 0.92, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8, transition: rm ? instant : { duration: 0.14, ease: 'easeIn' } }}
        transition={rm ? instant : SP.pop}
      >
        {children}
      </MModal>
    </MOverlay>
  )
}

/** react-aria Popover that grows from its trigger; render it as `{open && <PopPopover>}` inside <AnimatePresence>. */
export function PopPopover(p: Pick<PopoverProps, 'className' | 'placement' | 'isNonModal'> & { children: ReactNode }) {
  const rm = useReducedMotion()
  // While AnimatePresence plays the exit, the trigger is already closed: keep react-aria rendering it.
  const present = useIsPresent()
  return (
    <MPopover
      {...p}
      isExiting={!present}
      initial={{ opacity: 0, scale: 0.94, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -4, transition: rm ? instant : { duration: 0.12, ease: 'easeIn' } }}
      transition={rm ? instant : SP.menu}
    />
  )
}

/** Hand-made panel (UpdatePill) with the same open/close motion as PopPopover. */
export function PopPanel(p: HTMLMotionProps<'div'>) {
  const rm = useReducedMotion()
  return (
    <motion.div
      {...p}
      initial={{ opacity: 0, scale: 0.94, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -4, transition: rm ? instant : { duration: 0.12, ease: 'easeIn' } }}
      transition={rm ? instant : SP.menu}
    />
  )
}

/** Toast: pops in; on exit slides out, then the space it took closes. */
export function Toast({ children }: { children: ReactNode }) {
  const rm = useReducedMotion()
  const out = rm ? instant : { duration: 0.18, ease: 'easeIn' as const }
  const close = rm ? instant : { duration: 0.2, ease: [0.4, 0, 0.2, 1] as const, delay: 0.18 }
  return (
    <motion.div
      style={{ overflow: 'hidden' }}
      initial={{ opacity: 0, y: 18, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1, height: 'auto' }}
      exit={{ opacity: 0, x: 28, height: 0, transition: { opacity: out, x: out, height: close } }}
      transition={rm ? instant : SP.pop}
    >
      {children}
    </motion.div>
  )
}

/** Diff rows slide in 14ms apart when another file is shown (only the first screenful; the rest just appear). */
export function staggerIn(rows: Iterable<Element>) {
  if (reduced()) return
  const first = [...rows].slice(0, 60)
  if (first.length) animate(first, { opacity: [0, 1], x: [-6, 0] }, { duration: 0.22, ease: EASE, delay: stagger(0.014) })
}

/** Accent and mode changes crossfade (View Transitions; duration in global.css). */
export function withTransition(update: () => unknown) {
  if (!document.startViewTransition || reduced()) return void update()
  document.startViewTransition(async () => void (await update()))
}

/** Every key goes down 2px (tertiary 1px, segment scales) in 60ms and springs back on release (concept "Tuş basma"). */
export function installPress() {
  let pressed: HTMLElement | null = null
  const release = () => {
    if (!pressed) return
    const b = pressed
    pressed = null
    if (reduced()) return
    animate(b, b.matches('.segmented > button') ? { scale: 1 } : { y: 0 }, SP.release)
  }
  document.addEventListener('pointerdown', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button:not(:disabled)')
    if (!b || reduced()) return
    pressed = b
    if (b.matches('.segmented > button')) animate(b, { scale: 0.96 }, { duration: 0.08 })
    else animate(b, { y: b.matches('.ghost') ? 1 : 2 }, { duration: 0.06, ease: 'easeOut' })
  })
  document.addEventListener('pointerup', release)
  document.addEventListener('pointercancel', release)
}
