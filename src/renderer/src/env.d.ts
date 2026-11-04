import type { GitdockApi } from '../../shared/ipc'

declare global {
  interface Window {
    gitdock: GitdockApi
  }
}
