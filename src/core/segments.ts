/**
 * Markdown split into the prose a translation engine sees (segments) and everything kept byte for byte:
 * frontmatter keys, code and math blocks, comments, markers, table syntax, list and heading markers.
 * Pure (no Node imports) so the browser engine can use it too.
 */

export interface Segment {
  /** Prose to translate, with protected spans replaced by `{0}`, `{1}`…: also the cache key. */
  text: string
  /** The protected spans, in placeholder order (inline code, link targets, HTML, URLs…). */
  spans: string[]
  /** The source text this segment stands for (with its line breaks), emitted when nothing changed. */
  raw: string
  /** A paragraph wrapped over several lines: re-wrap the translation to the same width and indent. */
  wrap?: { width: number; first: number; indent: string }
  /** A frontmatter value: quoted as YAML needs, keeping the source's quotes. */
  yaml?: '"' | "'" | ''
}

/** Kept text and segments in document order. */
export type Part = string | Segment

export interface SplitDoc {
  parts: Part[]
  /** `\r\n` when the source used it; parts always use `\n`. */
  eol: string
}

/** Frontmatter keys whose values are prose; every other key and value is kept. */
const PROSE_KEYS = ['title', 'description', 'summary']

const PROTECT = new RegExp(
  [
    /<!--[\s\S]*?-->/.source, // comments and markode markers
    /``[^`]*``|`[^`]*`/.source, // inline code
    /\[\[[^\]]*\]\]/.source, // wiki links
    /\[\^[^\]]*\]/.source, // footnote references
    /\[![A-Za-z]+\][+-]?/.source, // callout type
    /\]\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\)/.source, // link and image targets
    /<https?:\/\/[^>\s]+>/.source, // autolinks
    /<\/?[A-Za-z][^<>]*>/.source, // inline HTML tags
    /https?:\/\/[^\s<>)\]]+/.source, // bare URLs
    /\{\s*\d+\s*\}/.source, // text that looks like a placeholder
  ].join('|'),
  'g',
)
const PLACEHOLDER = /\{\s*(\d+)\s*\}/g

/** A segment for `raw`, or `raw` itself when it holds nothing to translate. */
function segment(raw: string, extra: Partial<Segment> = {}): Part {
  const spans: string[] = []
  const text = raw.replace(PROTECT, (m) => `{${spans.push(m) - 1}}`)
  if (!/\p{L}/u.test(text.replace(PLACEHOLDER, ''))) return raw
  return { text, spans, raw, ...extra }
}

/** `content` with its trailing whitespace (and a hard break's backslash) moved to a kept suffix. */
function trimEnd(content: string): [string, string] {
  const m = /\\?\s*$/.exec(content)!
  return [content.slice(0, m.index), content.slice(m.index)]
}

const FENCE = /^((?:\s*>)*\s*)(`{3,}|~{3,})/
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const KEEP_LINE = [
  /^\s*([-*_])(\s*\1){2,}\s*$/, // thematic break
  /^\s*=+\s*$/, // setext heading underline
  /^\s*\[[^\]]+\]:\s/, // link reference definition
  /^\s*<\/?[A-Za-z][^>]*>\s*$/, // a line that is one HTML tag
  /^(\s*>)*\s*\[![A-Za-z]+\][+-]?\s*$/, // callout header
  /^\s*<!--[\s\S]*-->\s*$/, // a line that is only comments
]
/** Quote markers, then a heading or list marker (with its task box). */
const PREFIX = /^((?:\s*>)*\s?)(\s*)(#{1,6}\s+|(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?/

export function split(md: string): SplitDoc {
  const eol = md.includes('\r\n') ? '\r\n' : '\n'
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const parts: Part[] = []
  const keep = (s: string) => parts.push(s)
  const newline = (i: number) => {
    if (i < lines.length - 1) keep('\n')
  }

  // An open paragraph or list item: its lines are one segment. `lines` holds the source lines (the first
  // without its marker), `contents` the prose of each, `suffix` the last line's trailing whitespace.
  let para: { prefix: string; quote: string; lines: string[]; contents: string[]; suffix: string } | null = null
  // The newline after a paragraph's last line, emitted once it is known not to continue.
  let pendingNl = false
  const flush = () => {
    if (para) {
      const p = para
      para = null
      keep(p.prefix)
      const raw = p.lines.join('\n').slice(0, p.lines.join('\n').length - p.suffix.length)
      if (p.lines.length === 1) parts.push(segment(raw))
      else {
        const width = Math.max(p.prefix.length + p.lines[0].trimEnd().length, ...p.lines.slice(1).map((l) => l.trimEnd().length))
        const indent = PREFIX.exec(p.lines[1])![0]
        const seg = segment(p.contents.join(' '), { wrap: { width, first: p.prefix.length, indent } })
        parts.push(typeof seg === 'string' ? raw : { ...seg, raw })
      }
      keep(p.suffix)
    }
    if (pendingNl) keep('\n')
    pendingNl = false
  }

  let i = 0
  // Frontmatter: only the values of prose keys are translated.
  if (lines[0] === '---') {
    const end = lines.findIndex((l, j) => j > 0 && (l === '---' || l === '...'))
    if (end > 0) {
      for (; i <= end; i++) {
        const m = new RegExp(`^(\\s*(?:${PROSE_KEYS.join('|')}):\\s+)(.*?)(\\s*)$`).exec(lines[i])
        const quoted = m && /^(["'])(.*)\1$/.exec(m[2])
        if (m && quoted) parts.push(m[1], quoted[1], segment(quoted[2], { yaml: quoted[1] as '"' | "'" }), quoted[1], m[3])
        else if (m && m[2] && !/^[|>&*!{[]/.test(m[2])) parts.push(m[1], segment(m[2], { yaml: '' }), m[3])
        else keep(lines[i])
        newline(i)
      }
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i]
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const quote = fence[1].replace(/[^>]/g, '')
      const close = new RegExp(`^(?:\\s*>){${quote.length}}\\s*${fence[2][0] === '`' ? '`' : '~'}{${fence[2].length},}\\s*$`)
      let j = i + 1
      while (j < lines.length && !close.test(lines[j])) j++
      for (; i <= Math.min(j, lines.length - 1); i++) {
        keep(lines[i])
        newline(i)
      }
      i--
      continue
    }
    // A comment, or a math block, over several lines.
    const block = /^\s*<!--/.test(line) && !line.includes('-->') ? '-->' : /^\s*\$\$\s*$/.test(line) ? '$$' : null
    if (block) {
      flush()
      let j = i + 1
      while (j < lines.length && !lines[j].includes(block)) j++
      for (; i <= Math.min(j, lines.length - 1); i++) {
        keep(lines[i])
        newline(i)
      }
      i--
      continue
    }
    if (!line.trim() || KEEP_LINE.some((r) => r.test(line)) || TABLE_SEP.test(line) && line.includes('-')) {
      flush()
      keep(line)
      newline(i)
      continue
    }
    if (/^(\s*>)*\s*\|/.test(line)) {
      flush()
      tableRow(line, parts)
      newline(i)
      continue
    }

    const m = PREFIX.exec(line)!
    const quote = m[1].replace(/[^>]/g, '')
    const [content, suffix] = trimEnd(line.slice(m[0].length))
    if (para && !m[3] && quote === para.quote) {
      pendingNl = false
      para.lines.push(line)
      para.contents.push(content)
      para.suffix = suffix
    } else {
      flush()
      if (m[3]?.startsWith('#')) {
        const [, text, closing] = /^(.*?)(\s+#+)?$/.exec(content)!
        keep(m[0])
        parts.push(segment(text))
        keep((closing ?? '') + suffix)
        newline(i)
        continue
      }
      para = { prefix: m[0], quote, lines: [content + suffix], contents: [content], suffix }
    }
    pendingNl = i < lines.length - 1
    // A hard break (two spaces or a backslash) ends the segment: the line stays a line.
    if (/ {2,}$/.test(suffix) || suffix.startsWith('\\')) flush()
  }
  flush()
  return { parts, eol }
}

/** Cells of a table row: each cell's content is a segment; pipes, padding and quote markers are kept. */
function tableRow(line: string, parts: Part[]) {
  const quote = /^(\s*>)*\s*/.exec(line)![0]
  parts.push(quote)
  let cell = ''
  let code = false
  const pushCell = () => {
    const lead = /^\s*/.exec(cell)![0]
    const [content, trail] = trimEnd(cell.slice(lead.length))
    parts.push(lead)
    if (content) parts.push(segment(content))
    parts.push(trail)
    cell = ''
  }
  for (let k = quote.length; k < line.length; k++) {
    const c = line[k]
    if (c === '\\' && line[k + 1] === '|') {
      cell += '\\|'
      k++
    } else if (c === '`') {
      code = !code
      cell += c
    } else if (c === '|' && !code) {
      pushCell()
      parts.push('|')
    } else cell += c
  }
  pushCell()
}

/** The segments to translate, in document order. */
export const segmentsOf = (doc: SplitDoc) => doc.parts.filter((p): p is Segment => typeof p !== 'string')

/**
 * The translated text with its protected spans back. `ok` is false when the engine dropped or duplicated a
 * placeholder: dropped spans are appended at the end so nothing is lost, and the caller may retry.
 */
export function restore(seg: Segment, translated: string): { text: string; ok: boolean } {
  const used = seg.spans.map(() => 0)
  let ok = true
  let text = translated.trim().replace(PLACEHOLDER, (m, n) => {
    const k = Number(n)
    if (k >= seg.spans.length) {
      ok = false
      return m
    }
    used[k]++
    return seg.spans[k]
  })
  used.forEach((n, k) => {
    if (n !== 1) ok = false
    if (n === 0) text += ' ' + seg.spans[k]
  })
  return { text, ok }
}

function wrap(text: string, w: NonNullable<Segment['wrap']>): string {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/ +/)) {
    const budget = w.width - (lines.length ? w.indent.length : w.first)
    if (line && line.length + 1 + word.length > budget) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  lines.push(line)
  return lines.join('\n' + w.indent)
}

function yamlValue(text: string, quote: NonNullable<Segment['yaml']>): string {
  if (quote === '"') return JSON.stringify(text).slice(1, -1)
  if (quote === "'") return text.replace(/'/g, "''")
  return /^[\s\-?:,[\]{}#&*!|>'"%@`]|: | #|\s$/.test(text) ? JSON.stringify(text) : text
}

/**
 * The document with each segment replaced by `translate(segment, index)` (text with placeholders).
 * Returning undefined, or the segment's own text, keeps the source text as it was.
 */
export function join(doc: SplitDoc, translate: (seg: Segment, index: number) => string | undefined): string {
  let n = 0
  const out = doc.parts
    .map((p) => {
      if (typeof p === 'string') return p
      const t = translate(p, n++)
      if (t === undefined || t === p.text) return p.raw
      // Spaces inside a protected span are no place to wrap a line.
      const spans = p.wrap ? p.spans.map((s) => s.replace(/ /g, '\0')) : p.spans
      const text = restore({ ...p, spans }, t.replace(/\s*\n\s*/g, ' ')).text
      if (p.yaml !== undefined) return yamlValue(text, p.yaml)
      return p.wrap ? wrap(text, p.wrap).replace(/\0/g, ' ') : text
    })
    .join('')
  return doc.eol === '\n' ? out : out.replace(/\n/g, doc.eol)
}
