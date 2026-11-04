import { startMockServer, type MockServer } from './mock-server'

/** HTTP "git remote" that always answers 401 Basic, so git asks for credentials; inspect `requests` for what was sent. */
export function startAuthRemote(): Promise<MockServer> {
  return startMockServer({
    'GET /repo.git/info/refs': () => ({ status: 401, headers: { 'WWW-Authenticate': 'Basic realm="test"' }, body: 'auth' })
  })
}

export const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
