import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Switch as AriaSwitch, ToggleButton, ToggleButtonGroup } from 'react-aria-components'

/** react-aria Switch in the concept's tactile look (.switch in global.css). */
export function Switch(p: { isSelected: boolean; onChange(v: boolean): void; isDisabled?: boolean; children: ReactNode }) {
  return (
    <AriaSwitch isSelected={p.isSelected} onChange={p.onChange} isDisabled={p.isDisabled} className="switch">
      <span className="track" aria-hidden>
        <span className="knob" />
      </span>
      {p.children}
    </AriaSwitch>
  )
}

/** Single-choice react-aria ToggleButtonGroup drawn as the concept's segmented control with a sliding thumb. */
export function Segmented<T extends string>(p: { label: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const group = ref.current
    if (!group) return
    // offsetLeft already includes the rail's padding, so it is the thumb's x as-is.
    const place = () => {
      const b = group.querySelector<HTMLElement>('[data-selected]')
      setThumb(b ? { x: b.offsetLeft, w: b.offsetWidth } : null)
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(group)
    return () => ro.disconnect()
  }, [p.value])
  return (
    <ToggleButtonGroup
      ref={ref}
      aria-label={p.label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[p.value]}
      onSelectionChange={(keys) => {
        const k = [...keys][0]
        if (k !== undefined) p.onChange(String(k) as T)
      }}
      className="segmented"
    >
      {thumb && <span className="thumb" aria-hidden style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} />}
      {p.options.map(([v, text]) => (
        <ToggleButton key={v} id={v}>
          {text}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
