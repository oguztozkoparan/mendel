import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './global.css'
import { installPress } from './motion'
import { Tooltips } from './Tooltips'

void window.mendel['app:info']().then((info) => {
  document.documentElement.dataset.platform = info.platform
  document.documentElement.toggleAttribute('data-glass', info.glass)
})

// Local IPC: failures are real errors, not flaky network; show them instead of retrying.
// Refetch stale queries when the window regains focus (app switch), not only on visibilitychange.
focusManager.setEventListener((set) => {
  const on = () => set(true)
  const off = () => set(false)
  window.addEventListener('focus', on)
  window.addEventListener('blur', off)
  return () => (window.removeEventListener('focus', on), window.removeEventListener('blur', off))
})

installPress()

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <App />
        <Tooltips />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>
)
