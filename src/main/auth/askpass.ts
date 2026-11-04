// Askpass bridge (PLAN.md MVP "Auth"): git/ssh prompts go to the app instead of a terminal.
// git/ssh run GIT_ASKPASS/SSH_ASKPASS = this app's own executable (via a wrapper script outside packaged
// builds). That process detects GITDOCK_ASKPASS_TOKEN, sends the prompt over a local socket/pipe to the
// running app, prints the answer and exits (non-zero = cancelled). gitdock stores nothing.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'

export const ASKPASS_TOKEN_ENV = 'GITDOCK_ASKPASS_TOKEN'
export const ASKPASS_SOCKET_ENV = 'GITDOCK_ASKPASS_SOCKET'
const MAX_REQUEST = 64 * 1024

export interface AskpassServer {
  /** Env to add to every git process (see setGitEnv in git/runner). */
  env: Record<string, string>
  close(): void
}

export interface AskpassOptions {
  /** Command that starts this app in askpass mode (packaged: [process.execPath]). */
  command: string[]
  /** Answer a prompt; null = cancel. */
  onPrompt(prompt: string): Promise<string | null>
}

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export async function startAskpassServer({ command, onPrompt }: AskpassOptions): Promise<AskpassServer> {
  const win = process.platform === 'win32'
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gitdock-askpass-')) // mode 0700
  const token = randomBytes(32).toString('hex')
  const socket = win ? `\\\\.\\pipe\\gitdock-askpass-${randomBytes(16).toString('hex')}` : path.join(dir, 's')

  let program = command[0]
  if (command.length > 1 || !win) {
    // Wrapper so git/ssh can run us as a single executable path; prompt arrives as the last argument.
    // shortcut: Windows wrapper (.cmd, only outside packaged builds) re-parses %*; packaged Windows execs the exe directly.
    program = path.join(dir, win ? 'askpass.cmd' : 'askpass.sh')
    writeFileSync(
      program,
      win
        ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=\r\n${command.map((c) => `"${c}"`).join(' ')} %*\r\n`
        : `#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexec ${command.map(shQuote).join(' ')} "$@"\n`,
      { mode: 0o700 }
    )
  }

  const expected = Buffer.from(token)
  const server = createServer((conn) => {
    let buf = ''
    conn.setEncoding('utf8')
    conn.on('error', () => {})
    conn.on('data', (chunk: string) => {
      buf += chunk
      if (buf.length > MAX_REQUEST) return void conn.destroy()
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      conn.removeAllListeners('data')
      let req: { token?: unknown; prompt?: unknown }
      try {
        req = JSON.parse(buf.slice(0, nl))
      } catch {
        return void conn.destroy()
      }
      const got = Buffer.from(typeof req.token === 'string' ? req.token : '')
      if (got.length !== expected.length || !timingSafeEqual(got, expected) || typeof req.prompt !== 'string') return void conn.destroy()
      onPrompt(req.prompt)
        .catch(() => null)
        .then((value) => conn.end(JSON.stringify({ value }) + '\n'))
    })
  })
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(socket, resolve))

  return {
    env: {
      GIT_ASKPASS: program,
      SSH_ASKPASS: program,
      SSH_ASKPASS_REQUIRE: 'force', // OpenSSH >= 8.4: use askpass even without DISPLAY / with a tty
      [ASKPASS_SOCKET_ENV]: socket,
      [ASKPASS_TOKEN_ENV]: token
    },
    close: () => {
      server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** Askpass-mode side: ask the running app; null if cancelled or unreachable. */
export function requestAnswer(socket: string, token: string, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    let buf = ''
    const conn = createConnection(socket, () => conn.write(JSON.stringify({ token, prompt }) + '\n'))
    conn.setEncoding('utf8')
    conn.on('data', (c: string) => (buf += c))
    conn.on('error', () => resolve(null))
    conn.on('close', () => {
      try {
        const { value } = JSON.parse(buf) as { value: unknown }
        resolve(typeof value === 'string' ? value : null)
      } catch {
        resolve(null)
      }
    })
  })
}

/** How the prompt should be shown: free text (username), secret (password/passphrase) or yes/no (host key). */
export function promptKind(prompt: string): 'text' | 'secret' | 'confirm' {
  if (/\(yes\/no/i.test(prompt)) return 'confirm'
  if (/^username/i.test(prompt.trim())) return 'text'
  return 'secret'
}
