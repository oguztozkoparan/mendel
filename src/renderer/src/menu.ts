import { useEffect, useLayoutEffect, useRef } from 'react'
import type { MenuCommand } from '../../shared/ipc'

/** Run `handler` for native menu / accelerator commands (PLAN.md §7) while the component is mounted. */
export function useMenuCommand(handler: (cmd: MenuCommand) => void): void {
  const ref = useRef(handler)
  useLayoutEffect(() => {
    ref.current = handler
  })
  useEffect(() => window.mendel.on('menu:command', (c) => ref.current(c)), [])
}
