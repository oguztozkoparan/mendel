import type { MendelApi } from '../../shared/ipc'

declare global {
  interface Window {
    mendel: MendelApi
  }
}
