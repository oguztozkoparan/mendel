import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface MockRequest {
  method: string
  /** Path + query, e.g. `/a/changes/?q=status:open`. */
  url: string
  headers: IncomingHttpHeaders
  body: string
}

export interface MockResponse {
  status?: number
  headers?: Record<string, string>
  body?: string
}

/** Route key: `'<METHOD> <pathname>'`, e.g. `'GET /a/accounts/self'`; `'*'` catches the rest. Unmatched requests get 404. */
export type MockRoutes = Record<string, (req: MockRequest) => MockResponse | Promise<MockResponse>>

export interface MockServer {
  /** Base URL, `http://127.0.0.1:<port>`. */
  url: string
  /** Every request received, in order (for assertions). */
  requests: MockRequest[]
  close(): Promise<void>
}

/** Plain node:http server with a route table and request log. Provider mocks (e.g. Gerrit) build on this. */
export async function startMockServer(routes: MockRoutes): Promise<MockServer> {
  const requests: MockRequest[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const r: MockRequest = { method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
    requests.push(r)
    const route = routes[`${r.method} ${new URL(r.url, 'http://x').pathname}`] ?? routes['*']
    try {
      const out = route ? await route(r) : { status: 404, body: 'Not found' }
      res.writeHead(out.status ?? 200, out.headers).end(out.body ?? '')
    } catch (err) {
      res.writeHead(500).end(String(err))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
