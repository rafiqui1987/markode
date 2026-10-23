import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { GLOBAL_DIR } from './config.js'

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

/**
 * The log lives in the user's ~/.markode, one folder per project (by its real path), not in the project:
 * a repository could otherwise ship a log whose "comments" the agent would take as the user's.
 */
const logDir = (root: string) => path.join(GLOBAL_DIR, 'projects', crypto.createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 16))
const logFile = (root: string) => path.join(logDir(root), 'activity.jsonl')
const cursorFile = (root: string) => path.join(logDir(root), 'activity-cursor.json')
const MAX_LINES = 1000

/** The start of a comment or reply entry, up to its text; the closing `-->` is found by hand (see allEntries). */
const ENTRY_HEAD = /^<!-- (comment|reply) by ([^,\n]+), (\d{4}-\d{2}-\d{2})(?:, on "((?:[^"\\\n]|\\.)*)")?:\s?/
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/
/** Longer than any real comment: skipped rather than parsed. */
const MAX_ENTRY = 20_000

/**
 * Every comment and reply entry. HTML comments are found with indexOf: a lazy regex up to `-->` was
 * quadratic on an unclosed comment followed by many spaces.
 */
function allEntries(text: string) {
  const out: { raw: string; index: number; author: string; quote: string; text: string }[] = []
  for (let i = 0; ; ) {
    const s = text.indexOf('<!--', i)
    const e = s < 0 ? -1 : text.indexOf('-->', s + 4)
    if (e < 0) return out
    i = e + 3
    if (e - s > MAX_ENTRY) continue
    const raw = text.slice(s, i)
    const m = ENTRY_HEAD.exec(raw)
    if (m) out.push({ raw, index: s, author: m[2], quote: m[4] ?? '', text: raw.slice(m[0].length, -3).trim() })
  }
}

/** The user's comment and reply entries, as written. The agent's (`by AI`) are its own, not news. */
const entries = (text: string) => allEntries(text).filter((e) => e.author !== 'AI' && e.text)

/** `text` without its entries; a line that held only an entry goes with its line break. */
function stripEntries(text: string) {
  let out = ''
  let from = 0
  for (const e of allEntries(text)) {
    const end = e.index + e.raw.length
    const lineStart = text.lastIndexOf('\n', e.index - 1) + 1
    const nl = text.indexOf('\n', end)
    const lineEnd = nl < 0 ? text.length : nl
    const alone = !text.slice(Math.max(lineStart, from), e.index).trim() && !text.slice(end, lineEnd).trim()
    if (alone && lineStart >= from) {
      out += text.slice(from, lineStart)
      from = nl < 0 ? text.length : nl + 1
    } else {
      out += text.slice(from, e.index)
      from = end
    }
  }
  return out + text.slice(from)
}

/** Where each heading of `text` starts, in order: read once, then looked up for every change. */
function headings(text: string) {
  const out: { index: number; title: string }[] = []
  let index = 0
  for (const line of text.split('\n')) {
    const h = HEADING.exec(line)
    if (h) out.push({ index, title: h[1] })
    index += line.length + 1
  }
  return out
}

/** The heading above `index` (binary search in `list`, from `headings`). */
function sectionAt(list: ReturnType<typeof headings>, index: number) {
  let lo = 0
  let hi = list.length - 1
  let found: string | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].index <= index) (found = list[mid].title), (lo = mid + 1)
    else hi = mid - 1
  }
  return found
}

/** Proposals have their own flow: their comments go to the agent with the answer (`markode wait`). */
const isProposal = (text: string) => /^type:\s*proposal\s*$/m.test(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '')

/** Record a save from markode: the comments it added and, if more than comments changed, the edit. */
export function logSave(root: string, rel: string, before: string, after: string) {
  if (before === after || isProposal(after)) return
  const at = new Date().toISOString()
  const old = new Set(entries(before).map((e) => e.raw))
  const sections = headings(after)
  const out: Activity[] = entries(after)
    .filter((e) => !old.has(e.raw))
    .map((e) => ({ at, path: rel, kind: 'comment', section: sectionAt(sections, e.index), author: e.author, quote: e.quote || undefined, text: e.text }))
  // Whole comment lines go, line break included: adding a comment alone is not an edit.
  const a = stripEntries(before).split('\n')
  const b = stripEntries(after).split('\n')
  if (a.join('\n') !== b.join('\n')) {
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    out.push({ at, path: rel, kind: 'edit', section: sectionAt(headings(b.join('\n')), b.slice(0, i + 1).join('\n').length) })
  }
  if (!out.length) return
  const file = logFile(root)
  fs.mkdirSync(logDir(root), { recursive: true })
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
    const c = JSON.parse(fs.readFileSync(cursorFile(root), 'utf8'))
    return Number.isSafeInteger(c?.reported) && c.reported >= 0 ? { reported: c.reported } : null
  } catch {
    return null
  }
}

function writeCursor(root: string, c: Cursor) {
  fs.mkdirSync(logDir(root), { recursive: true })
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
        const e = JSON.parse(l)
        // Only what this module writes; anything else in the log is ignored.
        const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 2000) : undefined)
        if ((e.kind !== 'edit' && e.kind !== 'comment') || typeof e.path !== 'string') return []
        return [{ at: str(e.at) ?? '', path: e.path.slice(0, 500), kind: e.kind, section: str(e.section), author: str(e.author), quote: str(e.quote), text: str(e.text) } as Activity]
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
