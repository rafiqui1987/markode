import { syntaxTree } from '@codemirror/language'
import { EditorState, Facet, type Range, type RangeSet, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { LANG_NAMES } from '../api'
import type { T, TKey } from '../i18n'
import { choiceList, commentAuthor, CommentThreadWidget, findThreads, isChoiceMarker } from './comments'
import { linkActions } from './links'
import { BulletWidget, ChoiceLabelWidget, CheckboxWidget, CodeLangWidget, type Theme, FootnoteDefWidget, FootnoteRefWidget, imageUrl, ImageWidget, MarkerWidget, MathWidget, MermaidWidget, NoteWidget, RegionStartWidget, RuleWidget, showSource, TableWidget, TreeWidget } from './widgets'

/** Path of the open document, relative to the project: relative image paths resolve against it. */
export const docPath = Facet.define<string, string>({ combine: (v) => v[0] ?? '' })

/** Opens a project document in markode: where a relative link to a `.md` file goes. */
export const openDoc = Facet.define<(path: string) => void, ((path: string) => void) | null>({ combine: (v) => v[0] ?? null })

/** UI strings for widgets that show text (comment threads). */
export const translator = Facet.define<T, T>({ combine: (v) => v[0] ?? ((k: string) => k) as T })

/** The app's color theme; diagrams are re-rendered when it changes, without rebuilding the editor. */
export const setTheme = StateEffect.define<Theme>()
const theme = StateField.define<Theme>({
  create: () => (document.documentElement.dataset.resolvedTheme === 'light' ? 'light' : 'dark'),
  update: (value, tr) => tr.effects.reduce((v, e) => (e.is(setTheme) ? e.value : v), value),
})

const setFocused = StateEffect.define<boolean>()
const setPressing = StateEffect.define<boolean>()

/** Elements whose source can be shown on request: blocks from their `</>` button, inline ones on click. */
const BLOCKS = new Set(['FencedCode', 'Table', 'BlockMath'])
const INLINE = new Set(['Image', 'InlineMath', 'FootnoteRef', 'HorizontalRule', 'Comment', 'CommentBlock'])

/** The range whose source to show for the element at `pos`: the whole element, or else its line. */
function sourceRange(state: EditorState, pos: number) {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (BLOCKS.has(node.name)) return { from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.to).to }
    if (INLINE.has(node.name)) return { from: node.from, to: node.to }
  }
  const line = state.doc.lineAt(pos)
  return { from: line.from, to: line.to }
}

interface Reveal {
  /** The one element showing its Markdown source, if any; everything else stays rendered. */
  range: { from: number; to: number } | null
  /** A mouse button is down in the editor. */
  pressing: boolean
}

/**
 * The visual view never shows Markdown on its own: an element shows its source only when asked
 * (`showSource`), until the cursor leaves it or the editor loses focus. While the mouse is down
 * nothing switches: CodeMirror maps the pointer to a position again on every move and on release,
 * and an element switching between rendered and raw in the meantime would shift the text under it.
 */
const reveal = StateField.define<Reveal>({
  create: () => ({ range: null, pressing: false }),
  update(value, tr) {
    let { range, pressing } = value
    if (range && tr.docChanged) range = { from: tr.changes.mapPos(range.from, -1), to: tr.changes.mapPos(range.to, 1) }
    for (const e of tr.effects) {
      if (e.is(showSource)) range = sourceRange(tr.state, e.value)
      else if (e.is(setPressing)) pressing = e.value
      else if (e.is(setFocused) && !e.value) range = null
    }
    const head = tr.state.selection.main.head
    if (range && !pressing && (head < range.from || head > range.to)) range = null
    return range === value.range && pressing === value.pressing ? value : { range, pressing }
  },
})

/** Freezes what is revealed between mousedown and mouseup (see `reveal`). */
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

/** Comment threads and `<!-- choose: one -->` have widgets of their own. */
const OWN_WIDGET = /^\s*<!-- (?:(?:comment|reply) by |choose:)/

/** A marker tools read: `name:key:value`, no spaces (`markode:source-lang:es`, `rule:pnpm-only`). */
const MARKER = /^<!--\s*([\w.-]+(?::[\w.-]+)+)\s*-->$/

/** `<!-- name:key:start -->` / `:end`: the region's key (`name:key`) and which end it is. */
function regionMark(text: string) {
  const m = MARKER.exec(text.trim())
  const end = m && /:(start|end)$/.exec(m[1])
  return end && m[1].split(':').length > 2 ? { key: m[1].slice(0, end.index), start: end[1] === 'start' } : null
}

/** A region start marker, even with an empty or partial name. */
const START_LIKE = /^\s*<!--\s*[\w.:-]*:start\s*-->\s*$/

/**
 * Renaming a region in its start marker renames it in the end marker too, so the pair stays matched
 * (`<!-- region:a:start -->` … `<!-- region:a:end -->`).
 */
export const regionSync = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr
  const before = tr.startState.doc
  const renames: { from: number; to: number; insert: string }[] = []
  tr.changes.iterChangedRanges((fromA, _toA, fromB) => {
    const old = before.lineAt(fromA)
    const now = regionMark(tr.newDoc.lineAt(fromB).text)
    // The old start may have had no valid name for a moment (all of it deleted before typing a new one).
    if (!now?.start || !START_LIKE.test(old.text) || regionMark(old.text)?.key === now.key) return
    // Its end: the first one after it that closes no region nested inside.
    let depth = 0
    for (let n = old.number + 1; n <= before.lines; n++) {
      const l = before.line(n)
      const r = regionMark(l.text)
      if (!r) continue
      if (r.start) depth++
      else if (depth-- === 0) {
        if (r.key === now.key) break
        const at = l.from + l.text.indexOf(r.key)
        renames.push({ from: tr.changes.mapPos(at, 1), to: tr.changes.mapPos(at + r.key.length, -1), insert: now.key })
        break
      }
    }
  })
  return renames.length ? [tr, { changes: renames, sequential: true }] : tr
})

interface Preview {
  deco: DecorationSet
  /** Hidden or replaced syntax: the cursor steps over it as one unit. */
  atomic: RangeSet<Decoration>
  /** Per line, the hidden prefix (heading mark, bullet, quote mark) and where the text after it starts. */
  prefixes: Map<number, { from: number; to: number }>
}

/**
 * Visual view: Markdown syntax is hidden and rich blocks are rendered, always. Only the element
 * asked for (see `reveal`) shows its source.
 */
function build(state: EditorState): Preview {
  const out: Range<Decoration>[] = []
  const prefixes = new Map<number, { from: number; to: number }>()
  const { doc } = state
  const shown = state.field(reveal).range
  const touches = (from: number, to: number) => !!shown && shown.from <= to && shown.to >= from
  /** Hide a line's block prefix starting at `from`; the cursor goes after it and the spaces that follow. */
  const prefix = (from: number) => {
    const l = doc.lineAt(from)
    const rest = /^(?:#{1,6}|>|(?:[-*+]|\d+[.)])(?:\s+\[[ xX]\])?)\s*/.exec(l.text.slice(from - l.from))
    if (rest) prefixes.set(l.number, { from, to: from + rest[0].length })
  }
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

  // Regions a tool manages: each start line with its end line.
  const t = state.facet(translator)
  const regions = new Map<number, { end: number; key: string }>()
  // An end closes the open start with its key or, while its key is being renamed, the innermost one.
  const open: { key: string; line: number }[] = []
  for (let n = 1; n <= doc.lines; n++) {
    const r = regionMark(doc.line(n).text)
    if (r?.start) open.push({ key: r.key, line: n })
    else if (r && open.length) {
      const i = open.map((o) => o.key).lastIndexOf(r.key)
      const [o] = open.splice(i < 0 ? open.length - 1 : i, 1)
      regions.set(o.line, { end: n, key: o.key })
    }
  }
  const LABELS: Record<string, TKey> = { 'markode:rules': 'region.rules', 'markode:workflow': 'region.workflow', 'markode:proposals': 'region.proposals' }
  const regionLabel = (key: string) => (LABELS[key] ? t(LABELS[key]) : key.split(':').pop()!)
  for (const [start, { end, key }] of regions) {
    const first = doc.line(start)
    const last = doc.line(end)
    // The end marker's line shrinks to the bracket's closing corner while hidden.
    const closed = !touches(last.from, last.to)
    for (let n = start; n <= end; n++) out.push(line(`cm-region${n === start ? ' cm-region-start' : ''}${n === end ? ` cm-region-end${closed ? ' cm-region-closed' : ''}` : ''}`).range(doc.line(n).from))
    const title = `${doc.sliceString(first.from, first.to).trim()}${key.startsWith('markode:') ? `\n${t('region.managed')}` : ''}`
    if (!touches(first.from, first.to)) out.push(Decoration.replace({ widget: new RegionStartWidget(regionLabel(key), title) }).range(first.from, first.to))
    if (closed) out.push(hidden.range(last.from, last.to))
  }

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
        if (hm && name.startsWith('ATX') && !touches(node.from, node.to)) {
          out.push(hidden.range(hm.from, Math.min(hm.to + 1, node.to)))
          prefix(hm.from)
        }
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
          else return
          prefix(node.from)
          return
        }
        case 'Task': {
          const tm = node.node.getChild('TaskMarker')
          if (!tm) return
          const checked = /x/i.test(doc.sliceString(tm.from, tm.to))
          if (checked) out.push(line('cm-task-done').range(doc.lineAt(node.from).from))
          if (!lineTouches(node.from)) out.push(Decoration.replace({ widget: new CheckboxWidget(checked, !!choiceList(state, tm.from)) }).range(tm.from, tm.to))
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
        case 'QuoteMark': {
          if (lineTouches(node.from)) return
          out.push(hidden.range(node.from, doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to))
          prefix(node.from)
          return
        }
        case 'Comment':
        case 'CommentBlock': {
          const raw = doc.sliceString(node.from, node.to)
          if (OWN_WIDGET.test(raw) || regionMark(raw) || touches(node.from, node.to)) return false
          const marker = MARKER.exec(raw.trim())
          const parts = marker?.[1].split(':') ?? []
          let widget
          if (marker && parts[0] === 'markode' && parts[1] === 'source-lang') {
            const code = parts[2] ?? ''
            widget = new MarkerWidget((LANG_NAMES as Record<string, string>)[code] ?? code, t('marker.sourceLang'), true)
          } else if (marker) widget = new MarkerWidget(marker[1], marker[1], false)
          else widget = new NoteWidget(raw.replace(/^\s*<!--\s?|\s?-->\s*$/g, '').trim())
          out.push(Decoration.replace({ widget }).range(node.from, node.to))
          return false
        }
        case 'HorizontalRule': {
          if (!lineTouches(node.from)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to))
          return
        }
      }
    },
  })

  // Comment threads show as cards below the block they refer to; the commented text is highlighted.
  const author = state.facet(commentAuthor)
  for (const th of findThreads(doc)) {
    if (th.anchor) {
      const quote = th.entries[0].quote.replace(/…$/, '')
      const anchorText = doc.sliceString(th.anchor.from, th.anchor.to)
      const at = quote ? anchorText.indexOf(quote) : -1
      if (at >= 0) out.push(mark('cm-comment-anchor').range(th.anchor.from + at, th.anchor.from + at + quote.length))
      else out.push(line('cm-comment-anchor-line').range(th.anchor.from))
    }
    if (!touches(th.from, th.to)) out.push(Decoration.replace({ widget: new CommentThreadWidget(th.entries, author, state.facet(translator)), block: true }).range(th.from, th.to))
  }
  // `<!-- choose: one -->` before a checklist: a small label instead of the raw comment.
  for (let n = 1; n <= doc.lines; n++) {
    const l = doc.line(n)
    if (isChoiceMarker(l.text) && !touches(l.from, l.to)) out.push(Decoration.replace({ widget: new ChoiceLabelWidget(state.facet(translator)('choice.one')) }).range(l.from, l.to))
  }

  return { deco: Decoration.set(out, true), atomic: Decoration.set(out.filter((r) => r.value === hidden || r.value.spec.widget), true), prefixes }
}

const preview = StateField.define<Preview>({
  create: build,
  update(value, tr) {
    if (
      tr.docChanged ||
      // `false`: the fields are missing from the previous state when the visual view was just turned on.
      tr.startState.field(reveal, false)?.range !== tr.state.field(reveal).range ||
      tr.startState.field(theme, false) !== tr.state.field(theme) ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    )
      return build(tr.state)
    return value
  },
  provide: (f) => [EditorView.decorations.from(f, (p) => p.deco), EditorView.atomicRanges.of((view) => view.state.field(f).atomic)],
})

/**
 * A cursor never rests inside or before a hidden line prefix: typing there would break the heading,
 * list item or quote. It moves after the prefix, and arrowing left from there goes to the line above.
 */
const skipPrefixes = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr
  const sel = tr.selection.main
  if (!sel.empty) return tr
  const state = tr.state
  const line = state.doc.lineAt(sel.head)
  const p = state.field(preview).prefixes.get(line.number)
  if (!p || sel.head < p.from || sel.head >= p.to) return tr
  const before = tr.startState.selection.main.head
  const back = !tr.docChanged && !tr.isUserEvent('select.pointer') && before === p.to && line.number > 1
  return [tr, { selection: { anchor: back ? line.from - 1 : p.to }, sequential: true }]
})

export const livePreview = [theme, reveal, preview, skipPrefixes, pointerTracking, linkActions, EditorView.focusChangeEffect.of((_, focusing) => setFocused.of(focusing))]
