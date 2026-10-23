import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { assertInside, stateDir } from './config.js'
import { CURRENT_VERSION } from './update.js'

/**
 * The editor running for a project: `markode serve` records its port, so `markode url` can hand out
 * links to it (the port moves up when 4319 is taken) and start it only when it isn't running yet.
 */
export interface RunningServer {
  port: number
  pid: number
  /** Missing in records written before 0.4.2. */
  version?: string
}

const serverFile = (root: string) => path.join(stateDir(root), 'server.json')

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Record this process as the project's editor until it exits. */
export function recordServer(root: string, port: number) {
  const file = serverFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  assertInside(file)
  fs.writeFileSync(file, JSON.stringify({ port, pid: process.pid, version: CURRENT_VERSION }))
  process.once('exit', () => {
    // Another editor may have started for this project since; only remove our own record.
    if (runningServer(root)?.pid === process.pid) fs.rmSync(file, { force: true })
  })
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(sig, () => process.exit(130))
}

/** The project's editor, if its process is still alive. */
export function runningServer(root: string): RunningServer | null {
  try {
    const s = JSON.parse(fs.readFileSync(serverFile(root), 'utf8'))
    return Number.isInteger(s.port) && Number.isInteger(s.pid) && isAlive(s.pid) ? { port: s.port, pid: s.pid, version: s.version } : null
  } catch {
    return null
  }
}

/** Whether it answers: a crashed server's pid can be reused by another process. */
async function responds(port: number) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(1000) })).ok
  } catch {
    return false
  }
}

/**
 * The project's editor, started in the background (it outlives this command) when it isn't running.
 * `cli` is the script that runs markode, so the same version serves it: an editor of another version is
 * replaced, since updating markode deletes the files the old one serves.
 */
export async function ensureServer(root: string, cli: string, port: number): Promise<RunningServer> {
  const running = runningServer(root)
  if (running && running.version !== CURRENT_VERSION) {
    process.kill(running.pid)
    for (let i = 0; i < 50 && isAlive(running.pid); i++) await new Promise((r) => setTimeout(r, 100))
    port = running.port
  } else if (running && (await responds(running.port))) return running
  const child = spawn(process.execPath, [...process.execArgv, cli, 'serve', '--no-open', '--port', String(port)], {
    cwd: root,
    env: { ...process.env, MARKODE_ROOT: root },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const s = runningServer(root)
    if (s && s.pid === child.pid && (await responds(s.port))) return s
  }
  throw new Error('The editor did not start; run `markode serve` to see why.')
}

/** The link to the editor, or to one doc in it: `/open` shows it in the markode tab already open. */
export const editorUrl = (port: number, doc?: string) =>
  `http://localhost:${port}/${doc ? `open?path=${encodeURIComponent(doc).replace(/%2F/g, '/')}` : ''}`
