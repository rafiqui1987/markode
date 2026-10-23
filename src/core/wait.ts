import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { assertInside, stateDir } from './config.js'

/**
 * `markode wait <proposal>`: the agent runs it in the background after writing a proposal. It waits,
 * without using tokens, until the user answers in markode, then prints what the agent needs to go on.
 * While it runs, a pid file tells the app that the agent is listening.
 */
const waitsDir = (root: string) => path.join(stateDir(root), 'waits')
const pidFile = (root: string, rel: string) => path.join(waitsDir(root), `${encodeURIComponent(rel)}.pid`)

const frontmatter = (text: string): Record<string, unknown> => {
  try {
    return YAML.parse(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '', { logLevel: 'error' }) ?? {}
  } catch {
    return {}
  }
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Proposals an agent is waiting on right now. */
export function waitingOn(root: string): string[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(waitsDir(root)).filter((f) => f.endsWith('.pid'))
  } catch {}
  return names.flatMap((f) => {
    const pid = Number(fs.readFileSync(path.join(waitsDir(root), f), 'utf8'))
    return isAlive(pid) ? [decodeURIComponent(f.slice(0, -4))] : []
  })
}

/** Resolve once the proposal is `answered` (or deleted, or no longer a proposal). */
export function waitForAnswer(root: string, rel: string): Promise<'answered' | 'gone'> {
  const abs = path.join(root, rel)
  fs.mkdirSync(waitsDir(root), { recursive: true })
  assertInside(pidFile(root, rel))
  fs.writeFileSync(pidFile(root, rel), String(process.pid))
  const cleanup = () => fs.rmSync(pidFile(root, rel), { force: true })
  process.once('exit', cleanup)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(sig, () => process.exit(130))
  return new Promise((resolve) => {
    const poll = () => {
      let text: string
      try {
        text = fs.readFileSync(abs, 'utf8')
      } catch {
        return resolve('gone')
      }
      const fm = frontmatter(text)
      if (fm.type !== 'proposal') return resolve('gone')
      if (fm.status === 'answered') return resolve('answered')
      setTimeout(poll, 1500)
    }
    poll()
  })
}

const COMMENT = /^\s*<!-- (comment|reply) by (.+?), (\d{4}-\d{2}-\d{2})(?:, on "((?:[^"\\]|\\.)*)")?:\s?([\s\S]*?)\s*-->\s*$/

/** What the user answered, in plain text: choices, open questions, comments to reply to, what follows. */
export function answerSummary(root: string, rel: string): string {
  const text = fs.readFileSync(path.join(root, rel), 'utf8')
  const fm = frontmatter(text)
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const lines = body.split('\n')

  const chosen: string[] = []
  const unanswered: string[] = []
  const comments: string[] = []
  const after: string[] = []
  let heading = ''
  let question = ''
  let group: { label: string; ticked: boolean } | null = null
  let inAfter = false
  let thread: { author: string; text: string; quote: string }[] = []
  const closeGroup = () => {
    if (group && !group.ticked) unanswered.push(group.label)
    group = null
  }
  const closeThread = () => {
    // A thread needs a reply when its last word isn't the agent's.
    const last = thread.at(-1)
    if (last && last.author !== 'AI') comments.push(`${last.author}${thread[0].quote ? ` on "${thread[0].quote}"` : ''}: ${last.text}`)
    thread = []
  }

  for (const line of lines) {
    const c = COMMENT.exec(line)
    if (c) {
      if (c[1] === 'comment') closeThread()
      thread.push({ author: c[2], text: c[5].trim(), quote: c[4] ?? '' })
      continue
    }
    if (line.trim()) closeThread()
    const h = /^#{1,6}\s+(.*)/.exec(line)
    if (h) {
      closeGroup()
      heading = h[1].trim()
      question = ''
      inAfter = /^after your answer/i.test(heading)
      continue
    }
    if (inAfter && line.trim()) after.push(line.trim().replace(/^([-*+]|\d+\.)\s+/, ''))
    // What the next choices answer: a numbered question, or a line like "Watcher:".
    const q = /^\s*\d+\.\s+(.*\?)\s*$/.exec(line) ?? /^(\S.*[:?])\s*$/.exec(line)
    if (q && !/^\s*[-*+] /.test(line)) {
      closeGroup()
      question = q[1].trim().replace(/:$/, '')
    }
    if (/^\s*<!--\s*choose:\s*one\s*-->/.test(line)) {
      closeGroup()
      group = { label: question || heading, ticked: false }
      continue
    }
    const task = /^\s*[-*+] \[([ xX])\]\s*(.*)/.exec(line)
    if (task) {
      if (task[1] !== ' ') {
        chosen.push(`${question || heading}: ${task[2].trim()}`)
        if (group) group.ticked = true
      }
    } else if (group && line.trim() && !/^\s/.test(line)) closeGroup()
  }
  closeGroup()
  closeThread()

  const section = (title: string, items: string[]) => (items.length ? [`${title}:`, ...items.map((i) => `- ${i}`), ''] : [])
  const affects = Array.isArray(fm.affects) ? fm.affects.map(String) : []
  return [
    `Proposal ${rel} was answered.`,
    '',
    ...section('Chosen', chosen),
    ...section('Not answered', unanswered),
    ...section('Comments waiting for your reply', comments),
    ...section('Affects', affects),
    ...section('After the answer, you planned to', after),
    'Next: follow the markode-proposals skill ("When the user answers").',
  ].join('\n')
}
