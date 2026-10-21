import { syntaxTree } from '@codemirror/language'
import { type EditorState, Facet, type Text } from '@codemirror/state'
import { type EditorView, WidgetType } from '@codemirror/view'
import type { T } from '../i18n'

/**
 * Comments like in Word, stored as HTML comments right after the block they refer to, so they are
 * invisible on GitHub and readable by the AI:
 *
 *   <!-- comment by Ana, 2026-10-22, on "quoted text": What about X? -->
 *   <!-- reply by AI, 2026-10-22: Added to the architecture. -->
 *
 * A comment and the replies right below it form a thread. Lines are indented like the commented block.
 */
export interface CommentEntry {
  kind: 'comment' | 'reply'
  author: string
  date: string
  quote: string
  text: string
  from: number
  to: number
}

export interface Thread {
  from: number
  to: number
  indent: string
  entries: CommentEntry[]
  /** The line the thread refers to: the nearest non-blank, non-comment line above it. */
  anchor: { from: number; to: number } | null
}

/** Who signs new comments; null turns comment creation off (existing threads still show). */
export const commentAuthor = Facet.define<string | null, string | null>({ combine: (v) => v[0] ?? null })

const START = /^(\s*)<!-- (comment|reply) by /
/** Matched against the entry without its closing `-->` (see findThreads). */
const HEADER = /^\s*<!-- (comment|reply) by (.+?), (\d{4}-\d{2}-\d{2})(?:, on "((?:[^"\\]|\\.)*)")?:\s?([\s\S]*)$/

const unescape = (s: string) => s.replace(/\\(["\\])/g, '$1')
const escapeQuote = (s: string) => s.replace(/(["\\])/g, '\\$1')
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function findThreads(doc: Text): Thread[] {
  const threads: Thread[] = []
  let current: Thread | null = null
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const start = START.exec(line.text)
    if (!start) {
      if (line.text.trim()) current = null
      continue
    }
    // An entry may span several lines, up to the one that closes the HTML comment.
    let last = line
    while (!last.text.includes('-->') && last.number < doc.lines) last = doc.line(last.number + 1)
    // The closing `-->` is checked by hand: a lazy match up to it was quadratic on long runs of spaces.
    const raw = doc.sliceString(line.from, last.to).trimEnd()
    const m = raw.endsWith('-->') ? HEADER.exec(raw.slice(0, -3)) : null
    n = last.number
    if (!m) continue
    const entry: CommentEntry = { kind: m[1] as CommentEntry['kind'], author: m[2], date: m[3], quote: unescape(m[4] ?? ''), text: m[5].trim(), from: line.from, to: last.to }
    if (entry.kind === 'reply' && current) {
      current.entries.push(entry)
      current.to = last.to
      continue
    }
    let anchor: Thread['anchor'] = null
    for (let k = line.number - 1; k >= 1; k--) {
      const prev = doc.line(k)
      if (!prev.text.trim() || START.test(prev.text) || prev.text.includes('-->')) continue
      anchor = { from: prev.from, to: prev.to }
      break
    }
    current = { from: line.from, to: last.to, indent: start[1], entries: [entry], anchor }
    threads.push(current)
  }
  return threads
}

const entryText = (e: Pick<CommentEntry, 'kind' | 'author' | 'date' | 'quote' | 'text'>, indent: string) =>
  `${indent}<!-- ${e.kind} by ${e.author}, ${e.date}${e.kind === 'comment' && e.quote ? `, on "${escapeQuote(e.quote)}"` : ''}: ${e.text.replace(/-->/g, '-- >')} -->`

/** Where a new comment on [from, to] goes: after the block it is in, indented like that block's text. */
function insertionPoint(state: EditorState, pos: number): { at: number; indent: string } {
  const doc = state.doc
  let block = doc.lineAt(pos)
  let end = block.to
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    // A comment can't go inside a table or a paragraph: it would split them.
    if (node.name === 'Table' || node.name === 'Paragraph' || /Heading/.test(node.name)) {
      end = doc.lineAt(node.to).to
      block = doc.lineAt(node.from)
      break
    }
  }
  // Skip threads already there, so the new one goes after them.
  let next = doc.lineAt(end).number + 1
  while (next <= doc.lines && START.test(doc.line(next).text)) {
    let l = doc.line(next)
    while (!l.text.includes('-->') && l.number < doc.lines) l = doc.line(l.number + 1)
    end = l.to
    next = l.number + 1
  }
  const item = /^(\s*)([-*+]|\d+[.)])\s+/.exec(block.text)
  const indent = item ? ' '.repeat(item[0].length) : (/^\s*/.exec(block.text)?.[0] ?? '')
  return { at: end, indent }
}

/** Add an empty comment on the selection; its thread opens with a text box to write it. */
export function addComment(view: EditorView) {
  const author = view.state.facet(commentAuthor)
  if (!author) return
  const { from, to } = view.state.selection.main
  let quote = view.state.sliceDoc(from, to).replace(/\s+/g, ' ').trim()
  if (quote.length > 80) quote = quote.slice(0, 77) + '…'
  const { at, indent } = insertionPoint(view.state, to)
  view.dispatch({ changes: { from: at, insert: '\n' + entryText({ kind: 'comment', author, date: today(), quote, text: '' }, indent) }, selection: { anchor: from } })
}

/** The thread starting at the line of `pos`, found again in the current document. */
const threadAt = (view: EditorView, pos: number) => {
  const line = view.state.doc.lineAt(pos)
  return findThreads(view.state.doc).find((t) => t.from === line.from) ?? null
}

/** Remove a whole thread, with the line break before it. */
function resolve(view: EditorView, th: Thread) {
  const from = Math.max(0, th.from - 1)
  view.dispatch({ changes: { from, to: th.to } })
}

export class CommentThreadWidget extends WidgetType {
  constructor(
    readonly entries: CommentEntry[],
    readonly author: string | null,
    readonly translate: T,
  ) {
    super()
  }

  eq(other: CommentThreadWidget) {
    return other.author === this.author && JSON.stringify(other.entries.map(({ from, to, ...e }) => e)) === JSON.stringify(this.entries.map(({ from, to, ...e }) => e))
  }

  toDOM(view: EditorView) {
    const t = this.translate
    const dom = document.createElement('div')
    dom.className = 'cm-comment-thread'
    const find = () => threadAt(view, view.posAtDOM(dom))

    for (const e of this.entries) {
      if (!e.text) continue
      const item = document.createElement('div')
      item.className = `cm-comment cm-comment-${e.kind}`
      const head = document.createElement('div')
      head.className = 'cm-comment-head'
      const who = document.createElement('b')
      who.textContent = e.author
      const when = document.createElement('span')
      when.textContent = e.date
      head.append(who, when)
      item.append(head)
      if (e.quote) {
        const q = document.createElement('div')
        q.className = 'cm-comment-quote'
        q.textContent = e.quote
        item.append(q)
      }
      const body = document.createElement('div')
      body.className = 'cm-comment-text'
      body.textContent = e.text
      item.append(body)
      dom.append(item)
    }

    const pending = this.entries.length === 1 && !this.entries[0].text
    const button = (parent: HTMLElement, label: string, run: () => void, cls = '') => {
      const b = document.createElement('button')
      b.textContent = label
      if (cls) b.className = cls
      b.addEventListener('mousedown', (ev) => ev.preventDefault())
      b.addEventListener('click', run)
      parent.append(b)
      return b
    }

    // A text box: for the new comment itself, or for a reply.
    const editor = (placeholder: string, save: (text: string) => void, cancel: () => void) => {
      const box = document.createElement('div')
      box.className = 'cm-comment-editor'
      const area = document.createElement('textarea')
      area.placeholder = placeholder
      area.rows = 2
      area.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) save(area.value.trim())
        if (ev.key === 'Escape') cancel()
      })
      const actions = document.createElement('div')
      actions.className = 'cm-comment-actions'
      button(actions, t('comment.cancel'), cancel)
      button(actions, t('comment.save'), () => save(area.value.trim()), 'primary')
      box.append(area, actions)
      setTimeout(() => area.focus())
      return box
    }

    if (pending) {
      dom.classList.add('editing')
      dom.append(
        editor(
          t('comment.placeholder'),
          (text) => {
            const th = find()
            if (!th) return
            if (!text) return resolve(view, th)
            const e = th.entries[0]
            view.dispatch({ changes: { from: e.from, to: e.to, insert: entryText({ ...e, text }, th.indent) } })
          },
          () => {
            const th = find()
            if (th) resolve(view, th)
          },
        ),
      )
      return dom
    }

    if (this.author) {
      const actions = document.createElement('div')
      actions.className = 'cm-comment-actions'
      button(actions, t('comment.reply'), () => {
        actions.replaceWith(
          editor(
            t('comment.replyPlaceholder'),
            (text) => {
              const th = find()
              if (!th || !text) return
              view.dispatch({ changes: { from: th.to, insert: '\n' + entryText({ kind: 'reply', author: this.author!, date: today(), quote: '', text }, th.indent) } })
            },
            () => view.dispatch({}),
          ),
        )
      })
      button(actions, t('comment.resolve'), () => {
        const th = find()
        if (th) resolve(view, th)
      })
      dom.append(actions)
    }
    return dom
  }

  ignoreEvent() {
    return true
  }
}

// ------------------------------------------------------------ single-choice lists

const CHOOSE_ONE = /^\s*<!--\s*choose:\s*one\s*-->\s*$/

type Node = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>

/** The list holding the task at `pos`, if it is preceded by `<!-- choose: one -->`. */
export function choiceList(state: EditorState, pos: number): Node | null {
  let list: Node | null = syntaxTree(state).resolveInner(pos, 1)
  while (list && list.name !== 'BulletList' && list.name !== 'OrderedList') list = list.parent
  if (!list) return null
  for (let n = state.doc.lineAt(list.from).number - 1; n >= 1; n--) {
    const text = state.doc.line(n).text
    if (!text.trim()) continue
    return CHOOSE_ONE.test(text) ? list : null
  }
  return null
}

export const isChoiceMarker = (text: string) => CHOOSE_ONE.test(text)

/**
 * Toggle the task whose `[ ]` starts at `marker`. In a single-choice list, ticking one unticks the
 * others (ticking the chosen one again leaves none).
 */
export function toggleTaskAt(view: EditorView, marker: number) {
  const state = view.state
  if (!/^\[[ xX]\]$/.test(state.sliceDoc(marker, marker + 3))) return false
  const checked = state.sliceDoc(marker + 1, marker + 2) !== ' '
  const changes = [{ from: marker + 1, to: marker + 2, insert: checked ? ' ' : 'x' }]
  const list = checked ? null : choiceList(state, marker)
  if (list) {
    // Only the list's own items: nested lists have their own choice.
    for (let item = list.firstChild; item; item = item.nextSibling) {
      const tm = item.getChild('Task')?.getChild('TaskMarker')
      if (tm && tm.from !== marker && state.sliceDoc(tm.from + 1, tm.from + 2) !== ' ') changes.push({ from: tm.from + 1, to: tm.from + 2, insert: ' ' })
    }
  }
  view.dispatch({ changes })
  return true
}
