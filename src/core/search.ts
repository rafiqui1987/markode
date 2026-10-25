import fs from 'node:fs'
import ignore from 'ignore'

/** What to look for across the project's docs (the sidebar's content search). */
export interface SearchOptions {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  /** Match the text as it reads, without Markdown syntax (`**`, link URLs, HTML comments…). */
  rendered: boolean
  /** Comma-separated globs, .gitignore style (`docs/`, `*.md`, `tasks/T-*`); empty means every file. */
  include: string
  exclude: string
}

export interface SearchMatch {
  /** 1-based line; `col` and `len` are in the line's source text. */
  line: number
  col: number
  len: number
  /** The line around the match (as rendered, when `rendered`), and where the match is in it. */
  preview: string
  start: number
  end: number
  /** False when the match spans Markdown syntax that a replace would delete (e.g. `foo **bar**`). */
  replaceable: boolean
}

export interface FileMatches {
  path: string
  matches: SearchMatch[]
}

/** Matches returned at most; past it the result says `truncated`. */
export const MAX_MATCHES = 2000
const PREVIEW_BEFORE = 40
const PREVIEW_MAX = 200

export class QueryError extends Error {}

/** The query as a global regex, or null when it is empty. Throws QueryError when the regex is invalid. */
export function buildRegex(o: SearchOptions): RegExp | null {
  if (!o.query) return null
  const source = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const flags = 'g' + (o.caseSensitive ? '' : 'i')
  try {
    // Unicode-aware word edges, so "canción" is a whole word; patterns that aren't valid with the `u` flag fall back to \b.
    if (o.wholeWord) {
      try {
        return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, flags + 'u')
      } catch {
        return new RegExp(`\\b(?:${source})\\b`, flags)
      }
    }
    return new RegExp(source, flags)
  } catch (err) {
    throw new QueryError((err as Error).message)
  }
}

/** Whether a project-relative path passes the include / exclude globs. */
export function pathFilter(include: string, exclude: string): (rel: string) => boolean {
  const globs = (s: string) =>
    s
      .split(',')
      .map((g) => g.trim().replace(/^\.?\/+/, ''))
      .filter(Boolean)
  const inc = globs(include)
  const exc = globs(exclude)
  const incIg = ignore().add(inc)
  const excIg = ignore().add(exc)
  return (rel) => (!inc.length || incIg.ignores(rel)) && (!exc.length || !excIg.ignores(rel))
}

/** Per-line state of the rendered view: inside a code fence, an HTML comment or the frontmatter. */
interface LineState {
  fence: boolean
  comment: boolean
  frontmatter: boolean
}

/**
 * A line's text as it reads (`plain`) and, for each of its characters, the column it comes from in the
 * source. Only characters are dropped, never added, so every match maps back to a source span.
 */
function renderLine(line: string, index: number, state: LineState): { plain: string; cols: number[] } {
  const drop = new Uint8Array(line.length)
  const dropRange = (from: number, to: number) => drop.fill(1, from, to)
  const result = () => {
    const cols: number[] = []
    let plain = ''
    for (let i = 0; i < line.length; i++)
      if (!drop[i]) {
        plain += line[i]
        cols.push(i)
      }
    return { plain, cols }
  }

  if (index === 0 && line === '---') {
    state.frontmatter = true
    dropRange(0, line.length)
    return result()
  }
  if (state.frontmatter) {
    if (line === '---' || line === '...') {
      state.frontmatter = false
      dropRange(0, line.length)
    }
    return result()
  }
  if (/^\s*(```|~~~)/.test(line)) {
    state.fence = !state.fence
    dropRange(0, line.length)
    return result()
  }
  if (state.fence) return result()

  // HTML comments, which may span lines.
  let i = 0
  while (i < line.length) {
    if (state.comment) {
      const end = line.indexOf('-->', i)
      dropRange(i, end < 0 ? line.length : end + 3)
      if (end < 0) return result()
      state.comment = false
      i = end + 3
    } else {
      const start = line.indexOf('<!--', i)
      if (start < 0) break
      state.comment = true
      dropRange(start, start + 4)
      i = start + 4
    }
  }

  const all = (re: RegExp, each: (m: RegExpExecArray) => void) => {
    for (const m of line.matchAll(re)) each(m as RegExpExecArray)
  }
  // A table's separator row has no text at all.
  if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line) && line.includes('|')) {
    dropRange(0, line.length)
    return result()
  }
  // Block markers: quotes, headings, list bullets and task boxes.
  const block = /^\s*(?:>\s?)*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/.exec(line)
  if (block) dropRange(0, block[0].length)
  // Links and images keep their text: `[text](url)` → text.
  all(/!?\[([^\]\n]*)\]\(([^)\n]*)\)/g, (m) => {
    const textStart = m.index + m[0].indexOf('[') + 1
    dropRange(m.index, textStart)
    dropRange(textStart + m[1].length, m.index + m[0].length)
  })
  all(/<\/?[a-zA-Z][^<>\n]*>/g, (m) => {
    // An autolink keeps its URL: `<https://…>`.
    if (/^<[a-z][\w+.-]*:/i.test(m[0])) dropRange(m.index, m.index + 1), dropRange(m.index + m[0].length - 1, m.index + m[0].length)
    else dropRange(m.index, m.index + m[0].length)
  })
  // Escapes keep the escaped character; emphasis, strike, code and table pipes go.
  all(/\\([\\`*_{}[\]()#+\-.!|~<>])|\*+|~~|`+|__+|(?<!\\)\|/g, (m) => {
    if (m[1]) dropRange(m.index, m.index + 1)
    else dropRange(m.index, m.index + m[0].length)
  })
  return result()
}

/** Calls `each` for every match of `re` in `text`, line by line, with its source span. */
function eachMatch(text: string, o: SearchOptions, re: RegExp, each: (m: RegExpExecArray, line: number, view: string, start: number, end: number, from: number, to: number) => boolean | void) {
  const lines = text.split('\n')
  const state: LineState = { fence: false, comment: false, frontmatter: false }
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].endsWith('\r') ? lines[n].slice(0, -1) : lines[n]
    const { plain, cols } = o.rendered ? renderLine(line, n, state) : { plain: line, cols: null }
    re.lastIndex = 0
    for (let m = re.exec(plain); m; m = re.exec(plain)) {
      // Empty matches (e.g. `^`) find nothing to show.
      if (!m[0].length) {
        re.lastIndex++
        continue
      }
      const start = m.index
      const end = start + m[0].length
      const from = cols ? cols[start] : start
      const to = cols ? cols[end - 1] + 1 : end
      if (each(m, n, plain, start, end, from, to) === false) return
    }
  }
}

/** The line around a match, short enough for one sidebar row. */
function preview(view: string, start: number, end: number) {
  const lead = view.length - view.trimStart().length
  let from = Math.max(lead, start - PREVIEW_BEFORE)
  // Start the cut at a word, not in the middle of one.
  const space = from > lead ? view.indexOf(' ', from) : -1
  if (space >= 0 && space < start) from = space + 1
  const prefix = from > lead ? '…' : ''
  const text = prefix + view.slice(from, from + PREVIEW_MAX)
  return { preview: text.trimEnd(), start: start - from + prefix.length, end: Math.min(end - from, PREVIEW_MAX) + prefix.length }
}

/** Every match in one file's text. */
export function searchText(text: string, o: SearchOptions, re: RegExp, limit = MAX_MATCHES): SearchMatch[] {
  const out: SearchMatch[] = []
  eachMatch(text, o, re, (m, line, view, start, end, from, to) => {
    out.push({ line: line + 1, col: from, len: to - from, ...preview(view, start, end), replaceable: to - from === end - start })
    return out.length < limit
  })
  return out
}

/** Search a set of files; `files` maps each project path to the file holding the text shown for it. */
export function searchFiles(files: { path: string; file: string }[], o: SearchOptions): { files: FileMatches[]; total: number; truncated: boolean } {
  const re = buildRegex(o)
  if (!re) return { files: [], total: 0, truncated: false }
  const passes = pathFilter(o.include, o.exclude)
  const out: FileMatches[] = []
  let total = 0
  for (const f of files) {
    if (!passes(f.path)) continue
    let text: string
    try {
      text = fs.readFileSync(f.file, 'utf8')
    } catch {
      continue
    }
    const matches = searchText(text, o, re, MAX_MATCHES - total + 1)
    if (!matches.length) continue
    total += matches.length
    if (total > MAX_MATCHES) {
      out.push({ path: f.path, matches: matches.slice(0, matches.length - (total - MAX_MATCHES)) })
      return { files: out, total: MAX_MATCHES, truncated: true }
    }
    out.push({ path: f.path, matches })
  }
  return { files: out, total, truncated: false }
}

/** `$&`, `$1`, `$<name>` and `$$` in a regex replacement, as String.replace expands them. */
function expand(m: RegExpExecArray, replacement: string) {
  return replacement.replace(/\$(\$|&|\d{1,2}|<([^>]+)>)/g, (token, ref: string, name?: string) => {
    if (ref === '$') return '$'
    if (ref === '&') return m[0]
    if (name !== undefined) return m.groups?.[name] ?? ''
    const n = Number(ref)
    return n > 0 && n < m.length ? (m[n] ?? '') : token
  })
}

/**
 * The text with matches replaced; only the matched spans change, never the rest of the file. `only`
 * limits it to some matches (`line:col` keys, as returned by searchText). Matches that span Markdown
 * syntax are left alone.
 */
export function replaceText(text: string, o: SearchOptions, replacement: string, only?: Set<string>): { text: string; count: number } {
  const re = buildRegex(o)
  if (!re) return { text, count: 0 }
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
  const edits: { from: number; to: number; insert: string }[] = []
  eachMatch(text, o, re, (m, line, _view, start, end, from, to) => {
    if (to - from !== end - start) return
    if (only && !only.has(`${line + 1}:${from}`)) return
    edits.push({ from: lineStarts[line] + from, to: lineStarts[line] + to, insert: o.regex ? expand(m, replacement) : replacement })
  })
  let out = text
  for (const e of edits.reverse()) out = out.slice(0, e.from) + e.insert + out.slice(e.to)
  return { text: out, count: edits.length }
}
