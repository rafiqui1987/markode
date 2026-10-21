import { syntaxTree } from '@codemirror/language'
import { type EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Tooltip, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { Bold, Check, Code, createElement, type IconNode, Italic, Link, MessageSquarePlus, RemoveFormatting, Strikethrough } from 'lucide'
import { addComment, commentAuthor } from './comments'
import type { T, TKey } from '../i18n'

type Format = 'bold' | 'italic' | 'strike' | 'code' | 'link'

const NODE_FORMAT: Record<string, Format> = { StrongEmphasis: 'bold', Emphasis: 'italic', Strikethrough: 'strike', InlineCode: 'code', Link: 'link' }
const MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark'])
const NO_FORMAT = new Set(['FencedCode', 'CodeBlock', 'Frontmatter', 'HTMLBlock'])

const FORMATS: { id: Format; label: TKey; icon: IconNode }[] = [
  { id: 'bold', label: 'format.bold', icon: Bold },
  { id: 'italic', label: 'format.italic', icon: Italic },
  { id: 'strike', label: 'format.strike', icon: Strikethrough },
  { id: 'code', label: 'menu.inline', icon: Code },
  { id: 'link', label: 'menu.link', icon: Link },
]

/** Alternative syntaxes, offered on hover; the button itself applies the first one. */
const VARIANTS: Partial<Record<Format, { mark: string; sample: TKey }[]>> = {
  bold: [
    { mark: '**', sample: 'format.bold' },
    { mark: '__', sample: 'format.bold' },
    { mark: '***', sample: 'format.boldItalic' },
  ],
  italic: [
    { mark: '*', sample: 'format.italic' },
    { mark: '_', sample: 'format.italic' },
    { mark: '***', sample: 'format.boldItalic' },
  ],
}

const wrap = (text: string, f: Format, mark?: string) => {
  if (f === 'link') return `[${text}](url)`
  mark ??= { bold: '**', italic: '*', strike: '~~', code: text.includes('`') ? '``' : '`' }[f]
  return mark + text + mark
}

interface Target {
  /** Formats the whole selection already has (hidden from the bar); empty for mixed selections. */
  formats: Format[]
  /** Whether there is formatting to remove. */
  formatted: boolean
  /** Range to replace and its text with the formatting stripped. */
  from: number
  to: number
  text: string
}

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>

/** The marks around a formatted span's text: `**`, backticks, or `[` and `](url)` for links. */
function markRanges(node: SyntaxNode): [number, number][] {
  const marks: SyntaxNode[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) if (MARKS.has(c.name)) marks.push(c)
  if (marks.length < 2) return []
  return [
    [node.from, marks[0].to],
    [marks[1].from, node.to],
  ]
}

/**
 * What the selection is. Inside one formatted span: that span (its formats are hidden from the bar).
 * Across several: the selection widened to whole spans, with all their formatting stripped.
 */
function targetOf(state: EditorState): Target | null {
  let { from, to } = state.selection.main
  if (from === to || state.doc.lineAt(from).number !== state.doc.lineAt(to).number) return null
  const formats: Format[] = []
  let covering: SyntaxNode | null = null
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); node; node = node.parent) {
    if (NO_FORMAT.has(node.name)) return null
    const f = NODE_FORMAT[node.name]
    if (!f || node.from > from || node.to < to) continue
    formats.push(f)
    covering ??= node
  }
  const strip: [number, number][] = []
  if (covering) {
    ;({ from, to } = covering)
    strip.push(...markRanges(covering))
  } else {
    const sel = { from, to }
    syntaxTree(state).iterate({
      from: sel.from,
      to: sel.to,
      enter: (n) => {
        if (!NODE_FORMAT[n.name] || n.to <= sel.from || n.from >= sel.to) return
        from = Math.min(from, n.from)
        to = Math.max(to, n.to)
        strip.push(...markRanges(n.node))
      },
    })
  }
  let text = ''
  let pos = from
  for (const [a, b] of strip.sort((x, y) => x[0] - y[0])) {
    if (a > pos) text += state.sliceDoc(pos, a)
    pos = Math.max(pos, b)
  }
  text += state.sliceDoc(pos, to)
  return { formats, formatted: strip.length > 0, from, to, text }
}

/** Replace the target with its text in format `f` (or plain text when `f` is null). */
function apply(view: EditorView, t: Target, f: Format | null, mark?: string) {
  const insert = f ? wrap(t.text, f, mark) : t.text
  const start = t.from + (f ? insert.indexOf(t.text) : 0)
  // A new link selects its `url` placeholder; anything else keeps the text selected and the bar open.
  const selection = f === 'link' ? { anchor: t.from + insert.length - 4, head: t.from + insert.length - 1 } : { anchor: start, head: start + t.text.length }
  view.dispatch({ changes: { from: t.from, to: t.to, insert }, selection, effects: f === 'link' ? [] : showBar.of(true) })
  view.focus()
}

const showBar = StateEffect.define<boolean>()

/**
 * Selecting text (mouse or keyboard) copies it to the clipboard and opens a bar with the inline
 * formats it can be turned into; formats it already has are left out.
 */
export function formatBar(translate: T) {
  // Holds the analysed selection while the bar is open, so the bar is rebuilt whenever it changes.
  const barField = StateField.define<Target | null>({
    create: () => null,
    update(open, tr) {
      for (const e of tr.effects) if (e.is(showBar)) return e.value ? targetOf(tr.state) : null
      return tr.docChanged || tr.selection ? null : open
    },
    provide: (f) => showTooltip.compute([f], (state): Tooltip | null => {
      const target = state.field(f)
      return target ? barTooltip(state, target, translate) : null
    }),
  })

  const selectionWatcher = ViewPlugin.fromClass(
    class {
      last = ''
      onRelease = () => setTimeout(() => this.check())
      constructor(readonly view: EditorView) {
        addEventListener('mouseup', this.onRelease)
        view.dom.addEventListener('keyup', this.onRelease)
      }
      check() {
        const { view } = this
        const sel = view.state.selection.main
        const key = `${sel.from}:${sel.to}`
        if (sel.empty || !view.hasFocus || key === this.last) return
        this.last = key
        navigator.clipboard?.writeText(view.state.sliceDoc(sel.from, sel.to)).catch(() => {})
        if (targetOf(view.state)) view.dispatch({ effects: showBar.of(true) })
      }
      update(u: ViewUpdate) {
        if (u.state.selection.main.empty) this.last = ''
      }
      destroy() {
        removeEventListener('mouseup', this.onRelease)
        this.view.dom.removeEventListener('keyup', this.onRelease)
      }
    },
  )

  const closeKey = Prec.high(
    keymap.of([
      {
        key: 'Escape',
        run: (view) => {
          if (!view.state.field(barField)) return false
          view.dispatch({ effects: showBar.of(false) })
          return true
        },
      },
    ]),
  )

  return [barField, selectionWatcher, closeKey]
}

function barTooltip(state: EditorState, target: Target, translate: T): Tooltip {
  return {
    pos: state.selection.main.from,
    above: true,
    create: (view) => {
      const dom = document.createElement('div')
      dom.className = 'cm-format-bar'
      const button = (parent: HTMLElement, content: string | IconNode, run: () => void, label?: string) => {
        const b = document.createElement('button')
        if (label) b.title = label
        b.append(typeof content === 'string' ? content : createElement(content, { width: 15, height: 15 }))
        b.addEventListener('mousedown', (e) => {
          e.preventDefault()
          run()
        })
        parent.append(b)
        return b
      }
      for (const f of FORMATS) {
        if (target.formats.includes(f.id)) continue
        const variants = VARIANTS[f.id]
        if (!variants) {
          button(dom, f.icon, () => apply(view, targetOf(view.state)!, f.id), translate(f.label))
          continue
        }
        // Hovering the button shows its variants above it.
        const group = document.createElement('span')
        group.className = 'cm-format-group'
        button(group, f.icon, () => apply(view, targetOf(view.state)!, f.id), translate(f.label))
        const popover = document.createElement('div')
        popover.className = 'cm-format-variants'
        const list = document.createElement('div')
        for (const v of variants) {
          const b = button(list, v.mark + translate(v.sample) + v.mark, () => apply(view, targetOf(view.state)!, f.id, v.mark))
          b.className = `cm-variant-${v.mark.length === 3 ? 'both' : f.id}`
        }
        popover.append(list)
        group.append(popover)
        dom.append(group)
      }
      if (target.formatted) button(dom, RemoveFormatting, () => apply(view, targetOf(view.state)!, null), translate('format.plain'))
      if (state.facet(commentAuthor))
        button(
          dom,
          MessageSquarePlus,
          () => {
            view.dispatch({ effects: showBar.of(false) })
            addComment(view)
          },
          translate('format.comment'),
        )
      if (navigator.clipboard) {
        const copied = document.createElement('span')
        copied.className = 'cm-format-copied'
        copied.append(createElement(Check, { width: 13, height: 13 }), translate('format.copied'))
        dom.append(copied)
      }
      return { dom }
    },
  }
}
