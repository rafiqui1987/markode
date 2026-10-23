import fs from 'node:fs'
import path from 'node:path'
import { stateDir } from './config.js'

/**
 * What the user does in markode while an agent works: docs edited and comments added. The server logs
 * every save made from markode (the agent writes files directly, so its own edits never show up here);
 * `markode changes` reports what the agent hasn't been told yet.
 */
export interface Activity {
  at: string
  path: string
  kind: 'edit' | 'comment'
  /** The heading above the change, if any. */
  section?: string
  author?: string
  quote?: string
  text?: string
}

const logFile = (root: string) => path.join(stateDir(root), 'activity.jsonl')
const cursorFile = (root: string) => path.join(stateDir(root), 'activity-cursor.json')
const MAX_LINES = 1000

const ENTRY = /<!-- (comment|reply) by (.+?), (\d{4}-\d{2}-\d{2})(?:, on "((?:[^"\\]|\\.)*)")?:\s?([\s\S]*?)\s*-->/g
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/

/** The user's comment and reply entries, as written. The agent's (`by AI`) are its own, not news. */
function entries(text: string) {
  return [...text.matchAll(ENTRY)].filter((m) => m[2] !== 'AI' && m[5].trim()).map((m) => ({ raw: m[0], index: m.index!, author: m[2], quote: m[4] ?? '', text: m[5].trim() }))
}

function sectionAt(text: string, index: number) {
  const lines = text.slice(0, index).split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const h = HEADING.exec(lines[i])
    if (h) return h[1]
  }
  return undefined
}

/** Proposals have their own flow: their comments go to the agent with the answer (`markode wait`). */
const isProposal = (text: string) => /^type:\s*proposal\s*$/m.test(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '')

/** Record a save from markode: the comments it added and, if more than comments changed, the edit. */
export function logSave(root: string, rel: string, before: string, after: string) {
  if (before === after || isProposal(after)) return
  const at = new Date().toISOString()
  const old = new Set(entries(before).map((e) => e.raw))
  const out: Activity[] = entries(after)
    .filter((e) => !old.has(e.raw))
    .map((e) => ({ at, path: rel, kind: 'comment', section: sectionAt(after, e.index), author: e.author, quote: e.quote || undefined, text: e.text }))
  // Whole comment lines go, line break included: adding a comment alone is not an edit.
  const strip = (t: string) => t.replace(new RegExp(`^[ \\t]*${ENTRY.source}[ \\t]*\\r?\\n`, 'gm'), '').replace(ENTRY, '')
  const a = strip(before).split('\n')
  const b = strip(after).split('\n')
  if (a.join('\n') !== b.join('\n')) {
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    out.push({ at, path: rel, kind: 'edit', section: sectionAt(b.join('\n'), b.slice(0, i + 1).join('\n').length) })
  }
  if (!out.length) return
  fs.mkdirSync(stateDir(root), { recursive: true })
  const file = logFile(root)
  fs.appendFileSync(file, out.map((e) => JSON.stringify(e)).join('\n') + '\n')
  // Keep the log small: once reported, old entries are of no use.
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n').filter(Boolean)
  if (lines.length > MAX_LINES) {
    const kept = lines.slice(-MAX_LINES / 2).join('\n') + '\n'
    fs.writeFileSync(file, kept)
    // The cursor moves back by what was cut, so nothing is reported twice.
    const removed = Buffer.byteLength(text) - Buffer.byteLength(kept)
    const cursor = readCursor(root)
    if (cursor) writeCursor(root, { reported: Math.max(0, cursor.reported - removed) })
  }
}

interface Cursor {
  /** Byte offset in the log up to which the agent has been told. */
  reported: number
}

function readCursor(root: string): Cursor | null {
  try {
    return JSON.parse(fs.readFileSync(cursorFile(root), 'utf8'))
  } catch {
    return null
  }
}

function writeCursor(root: string, c: Cursor) {
  fs.mkdirSync(stateDir(root), { recursive: true })
  fs.writeFileSync(cursorFile(root), JSON.stringify(c) + '\n')
}

const logSize = (root: string) => (fs.existsSync(logFile(root)) ? fs.statSync(logFile(root)).size : 0)

/** A new agent session: only what happens from now on is news. */
export function startSession(root: string) {
  writeCursor(root, { reported: logSize(root) })
}

/** What happened since the agent was last told, and mark it as told. Without a session, nothing is old news. */
export function takeChanges(root: string): Activity[] {
  const size = logSize(root)
  const cursor = readCursor(root)
  const from = cursor && cursor.reported <= size ? cursor.reported : size
  if (from === size) {
    if (!cursor) writeCursor(root, { reported: size })
    return []
  }
  const fd = fs.openSync(logFile(root), 'r')
  const buf = Buffer.alloc(size - from)
  fs.readSync(fd, buf, 0, buf.length, from)
  fs.closeSync(fd)
  writeCursor(root, { reported: size })
  return buf
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Activity]
      } catch {
        return []
      }
    })
}

/** The report the agent reads: edits grouped by doc, then every new comment. Empty when nothing happened. */
export function formatChanges(list: Activity[]): string {
  if (!list.length) return ''
  const edits = new Map<string, Set<string>>()
  for (const e of list.filter((e) => e.kind === 'edit')) {
    const sections = edits.get(e.path) ?? new Set()
    if (e.section) sections.add(e.section)
    edits.set(e.path, sections)
  }
  const comments = list.filter((e) => e.kind === 'comment')
  const lines = ['markode: the user changed docs while you worked (see "While you work" in the markode skill).']
  if (edits.size) {
    lines.push('', 'Edited (re-read before working on that part; nothing to do otherwise):')
    for (const [p, s] of edits) lines.push(`- ${p}${s.size ? ` (${[...s].map((x) => `"${x}"`).join(', ')})` : ''}`)
  }
  if (comments.length) {
    lines.push('', 'New comments (about your current work: reply below it and apply it; otherwise ask the user in one line whether to take it now):')
    for (const c of comments) lines.push(`- ${c.path}${c.section ? ` › "${c.section}"` : ''}${c.quote ? `, on "${c.quote}"` : ''}: ${c.text} (${c.author})`)
  }
  return lines.join('\n')
}
