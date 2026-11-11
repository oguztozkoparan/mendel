// HTTP helpers shared by all providers. No electron imports: unit tests load this directly.

/** fetch as main injects it (electron net.fetch) and tests replace it. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

const MAX_BODY = 20 * 1024 * 1024

/** Read a response body as text, failing once it exceeds `max` bytes. */
export async function readCapped(res: Response, max = MAX_BODY): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw new Error('Response too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Credential key of a provider base URL. */
export const hostOf = (baseUrl: string) => new URL(baseUrl).host
