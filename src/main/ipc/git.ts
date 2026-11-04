import { gitInfo } from '../git/info'
import type { Handlers } from '.'

export const gitHandlers: Handlers<'git:info'> = {
  'git:info': (req) => gitInfo(req?.recheck)
}
