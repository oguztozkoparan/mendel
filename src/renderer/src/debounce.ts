import { useEffect, useMemo, useRef } from 'react'

/** `run` calls `fn` once input pauses for `ms`; `now` calls it at once and drops a pending run. */
export function useDebounced<T>(fn: (v: T) => void, ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => () => clearTimeout(timer.current), [])
  return useMemo(
    () => ({
      run: (v: T) => {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => latest.current(v), ms)
      },
      now: (v: T) => {
        clearTimeout(timer.current)
        latest.current(v)
      }
    }),
    [ms]
  )
}
