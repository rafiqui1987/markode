import { syntaxTree } from '@codemirror/language'
import { type EditorState, Facet, type Range, type SelectionRange, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { BulletWidget, CheckboxWidget, CodeLangWidget, type Theme, FootnoteDefWidget, FootnoteRefWidget, imageUrl, ImageWidget, MathWidget, MermaidWidget, RuleWidget, TableWidget, TreeWidget } from './widgets'

/** Path of the open document, relative to the project: relative image paths resolve against it. */
export const docPath = Facet.define<string, string>({ combine: (v) => v[0] ?? '' })

/** The app's color theme; diagrams are re-rendered when it changes, without rebuilding the editor. */
export const setTheme = StateEffect.define<Theme>()
const theme = StateField.define<Theme>({
  create: () => (document.documentElement.dataset.resolvedTheme === 'light' ? 'light' : 'dark'),
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setTheme) ? e.value : v), value),
})

const setFocused = StateEffect.define<boolean>()
const setPressing = StateEffect.define<boolean>()

interface Reveal {
  /** Without focus nothing shows raw source, even where the cursor sits. */
  focused: boolean
  /** Ranges whose lines show raw source. */
  ranges: readonly SelectionRange[]
  /** A mouse button is down in the editor. */
  pressing: boolean
}

/**
 * Where raw source is shown. While the mouse is down it stays frozen: CodeMirror maps the pointer
 * to a position again on every move and on release, and blocks switching between rendered and raw
 * in the meantime would shift the text under the pointer (clicks landing paragraphs below).
 */
const reveal = StateField.define<Reveal>({
  create: (state) => ({ focused: false, ranges: state.selection.ranges, pressing: false }),
  update(value, tr) {
    let v = value
    if (tr.docChanged) v = { ...v, ranges: v.ranges.map((r) => r.map(tr.changes)) }
    for (const e of tr.effects) {
      if (e.is(setPressing)) v = e.value ? { ...v, pressing: true } : { focused: v.focused, ranges: tr.state.selection.ranges, pressing: false }
      else if (e.is(setFocused)) v = { ...v, focused: e.value, ...(v.pressing ? {} : { ranges: tr.state.selection.ranges }) }
    }
    if (tr.selection && !v.pressing) v = { ...v, ranges: tr.state.selection.ranges }
    else if (tr.selection && !tr.isUserEvent('select.pointer')) v = { ...v, ranges: tr.state.selection.ranges, pressing: false }
    return v
  },
})

/** Freezes the revealed ranges between mousedown and mouseup (see `reveal`). */
const pointerTracking = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false
    view.dispatch({ effects: setPressing.of(true) })
    // Window listeners run after CodeMirror's document one, which sets the final selection.
    addEventListener('mouseup', () => view.dispatch({ effects: setPressing.of(false) }), { once: true })
    return false
  },
})

const hidden = Decoration.replace({})
const line = (cls: string) => Decoration.line({ class: cls })
const mark = (cls: string) => Decoration.mark({ class: cls })

/**
 * Obsidian-style live preview: Markdown syntax is hidden and rich blocks are
 * rendered everywhere except where the selection touches, which shows raw source.
 */
function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const { doc } = state
  const { focused, ranges } = state.field(reveal)
  const touches = (from: number, to: number) => focused && ranges.some((r) => r.from <= to && r.to >= from)
  const lineTouches = (pos: number) => {
    const l = doc.lineAt(pos)
    return touches(l.from, l.to)
  }
  const eachLine = (from: number, to: number, fn: (l: { from: number; to: number; text: string }, i: number, last: boolean) => void) => {
    const first = doc.lineAt(from).number
    const lastN = doc.lineAt(to).number
    for (let n = first; n <= lastN; n++) fn(doc.line(n), n - first, n === lastN)
  }

  // Footnotes are numbered in order of first reference, as GitHub does; definitions give the hover text.
  const text = doc.toString()
  const notes = new Map<string, string>()
  for (const m of text.matchAll(/^\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm)) notes.set(m[1], m[2])
  const numbers = new Map<string, string>()
  for (const m of text.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) if (!numbers.has(m[1])) numbers.set(m[1], String(numbers.size + 1))
  const footnoteNumber = (label: string) => numbers.get(label) ?? label

  syntaxTree(state).iterate({
    enter(node) {
      const name = node.name
      const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name)

      if (name === 'Frontmatter') {
        eachLine(node.from, node.to, (l, i, last) => {
          out.push(line(`cm-fm${i === 0 ? ' cm-fm-start' : ''}${last ? ' cm-fm-end' : ''}`).range(l.from))
          const key = /^([\w-]+):/.exec(l.text)
          if (key) out.push(mark('cm-fm-key').range(l.from, l.from + key[1].length))
        })
        return false
      }

      if (heading) {
        out.push(line(`cm-h cm-h${heading[1]}`).range(doc.lineAt(node.from).from))
        const hm = node.node.getChild('HeaderMark')
        if (hm && name.startsWith('ATX') && !touches(node.from, node.to)) out.push(hidden.range(hm.from, Math.min(hm.to + 1, node.to)))
        return
      }

      switch (name) {
        case 'Emphasis':
        case 'StrongEmphasis':
        case 'Strikethrough': {
          if (touches(node.from, node.to)) return
          for (const m of node.node.getChildren(name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark')) out.push(hidden.range(m.from, m.to))
          return
        }
        case 'InlineCode': {
          out.push(mark('cm-inline-code').range(node.from, node.to))
          if (!touches(node.from, node.to)) for (const m of node.node.getChildren('CodeMark')) out.push(hidden.range(m.from, m.to))
          return false
        }
        case 'Link': {
          const marks = node.node.getChildren('LinkMark')
          if (marks.length < 2 || touches(node.from, node.to)) return
          out.push(hidden.range(marks[0].from, marks[0].to))
          out.push(mark('cm-link-text').range(marks[0].to, marks[1].from))
          out.push(hidden.range(marks[1].from, node.to))
          // A linked image (badge) still renders its image.
          return node.node.getChild('Image') ? undefined : false
        }
        case 'Image': {
          const marks = node.node.getChildren('LinkMark')
          const url = node.node.getChild('URL')
          if (marks.length < 2 || !url || touches(node.from, node.to)) return false
          const title = node.node.getChild('LinkTitle')
          const src = imageUrl(doc.sliceString(url.from, url.to).replace(/^<|>$/g, ''), state.facet(docPath))
          const titleText = title ? doc.sliceString(title.from + 1, title.to - 1) : ''
          out.push(Decoration.replace({ widget: new ImageWidget(src, doc.sliceString(marks[0].to, marks[1].from), titleText) }).range(node.from, node.to))
          return false
        }
        case 'InlineMath': {
          if (!touches(node.from, node.to)) out.push(Decoration.replace({ widget: new MathWidget(doc.sliceString(node.from + 1, node.to - 1), false) }).range(node.from, node.to))
          return false
        }
        case 'BlockMath': {
          const from = doc.lineAt(node.from).from
          const to = doc.lineAt(node.to).to
          if (!touches(from, to)) {
            const tex = doc.sliceString(node.from, node.to).replace(/^\s*\$\$/, '').replace(/\$\$\s*$/, '').trim()
            out.push(Decoration.replace({ widget: new MathWidget(tex, true), block: true }).range(from, to))
          } else eachLine(from, to, (l) => out.push(line('cm-math-src').range(l.from)))
          return false
        }
        case 'FootnoteRef': {
          const label = doc.sliceString(node.from + 2, node.to - 1)
          const lineStart = doc.lineAt(node.from).from
          if (node.from === lineStart && doc.sliceString(node.to, node.to + 1) === ':') {
            out.push(line('cm-footnote-def').range(lineStart))
            if (!lineTouches(node.from)) out.push(Decoration.replace({ widget: new FootnoteDefWidget(footnoteNumber(label)) }).range(node.from, node.to + 1))
          } else if (!touches(node.from, node.to)) out.push(Decoration.replace({ widget: new FootnoteRefWidget(footnoteNumber(label), notes.get(label) ?? '') }).range(node.from, node.to))
          return false
        }
        case 'ListMark': {
          out.push(mark('cm-list-mark').range(node.from, node.to))
          if (lineTouches(node.from)) return
          const next = node.node.nextSibling
          if (next?.name === 'Task') out.push(hidden.range(node.from, Math.min(node.to + 1, next.from)))
          else if (node.node.parent?.parent?.name === 'BulletList') out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to))
          return
        }
        case 'Task': {
          const tm = node.node.getChild('TaskMarker')
          if (!tm) return
          const checked = /x/i.test(doc.sliceString(tm.from, tm.to))
          if (checked) out.push(line('cm-task-done').range(doc.lineAt(node.from).from))
          if (!lineTouches(node.from)) out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(tm.from, tm.to))
          return
        }
        case 'FencedCode': {
          const info = node.node.getChild('CodeInfo')
          const lang = info ? doc.sliceString(info.from, info.to).trim().toLowerCase() : ''
          const from = doc.lineAt(node.from).from
          const to = doc.lineAt(node.to).to
          if ((lang === 'mermaid' || lang === 'tree') && !touches(from, to)) {
            const text = node.node.getChild('CodeText')
            const code = text ? doc.sliceString(text.from, text.to) : ''
            out.push(Decoration.replace({ widget: lang === 'mermaid' ? new MermaidWidget(code, state.field(theme)) : new TreeWidget(code), block: true }).range(from, to))
            return false
          }
          // Away from the cursor the fences are hidden and the opening one only shows the language.
          // They stay in the document, so copying still gives the full Markdown.
          const closing = node.node.lastChild
          const closed = closing?.name === 'CodeMark' && doc.lineAt(closing.from).number > doc.lineAt(node.from).number
          const hideFences = !touches(from, to)
          eachLine(from, to, (l, i, last) => {
            const collapsed = hideFences && ((i === 0 && !lang) || (last && closed))
            out.push(line(`cm-codeblock${i === 0 ? ' cm-codeblock-start' : ''}${last ? ' cm-codeblock-end' : ''}${collapsed ? ' cm-fence-collapsed' : ''}`).range(l.from))
          })
          if (hideFences) {
            const open = doc.lineAt(node.from)
            out.push((lang ? Decoration.replace({ widget: new CodeLangWidget(lang) }) : hidden).range(open.from, open.to))
            if (closed) out.push(hidden.range(doc.lineAt(node.to).from, doc.lineAt(node.to).to))
          }
          return false
        }
        case 'Table': {
          const from = doc.lineAt(node.from).from
          const to = doc.lineAt(node.to).to
          if (!touches(from, to)) {
            out.push(Decoration.replace({ widget: new TableWidget(doc.sliceString(from, to)), block: true }).range(from, to))
            return false
          }
          eachLine(from, to, (l) => out.push(line('cm-table-src').range(l.from)))
          return false
        }
        case 'Blockquote': {
          eachLine(node.from, node.to, (l) => out.push(line('cm-quote').range(l.from)))
          return
        }
        case 'HorizontalRule': {
          if (!lineTouches(node.from)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to))
          return
        }
      }
    },
  })

  return Decoration.set(out, true)
}

const preview = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    const before = tr.startState.field(reveal)
    const after = tr.state.field(reveal)
    if (
      tr.docChanged ||
      before.focused !== after.focused ||
      before.ranges !== after.ranges ||
      tr.startState.field(theme) !== tr.state.field(theme) ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    )
      return build(tr.state)
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

export const livePreview = [theme, reveal, preview, pointerTracking, EditorView.focusChangeEffect.of((_, focusing) => setFocused.of(focusing))]
