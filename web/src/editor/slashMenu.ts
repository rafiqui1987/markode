import { type EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import {
  Braces,
  Code,
  Columns3,
  createElement,
  Ellipsis,
  EyeOff,
  FolderTree,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  type IconNode,
  Link,
  List,
  ListChecks,
  ListOrdered,
  ListTodo,
  MessageSquare,
  MessageSquarePlus,
  Minus,
  Network,
  Quote,
  Rows3,
  SquareCode,
  SquareDashed,
  Tag,
  Table,
  Terminal,
  Workflow,
} from 'lucide'
import type { T, TKey } from '../i18n'
import { addComment, commentAuthor } from './comments'
import { parseTable, serializeTable, tableRangeAt } from './table'
import { showSource } from './widgets'

interface Item {
  label: TKey
  icon: IconNode
  hint?: string
  run: (view: EditorView) => void
  /** Shown only when this holds (e.g. comment threads need comments turned on). */
  when?: (state: EditorState) => boolean
}
interface Group {
  label: TKey
  icon: IconNode
  items: Item[]
}

// ------------------------------------------------------------ edit helpers

const LINE_PREFIX = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)?/

/** The lines a command applies to: every line the selection touches, or the cursor line. */
function targetLines(state: EditorState) {
  const { from, to } = state.selection.main
  const first = state.doc.lineAt(from)
  let last = state.doc.lineAt(to)
  // A selection that ends at the start of a line doesn't take that line.
  if (to > from && to === last.from && last.number > first.number) last = state.doc.line(last.number - 1)
  return Array.from({ length: last.number - first.number + 1 }, (_, i) => state.doc.line(first.number + i))
}

/** Where a line's text starts, after its indentation and block prefix (heading, list, quote). */
function prefixRange(line: { from: number; text: string }) {
  const m = LINE_PREFIX.exec(line.text)!
  const from = line.from + m[1].length
  return { from, to: from + (m[2]?.length ?? 0) }
}

/**
 * Replace the block prefix of the target lines with `prefix` (numbered lists count up). Blank lines are
 * skipped, except in quotes, where they keep the quote together.
 */
function setLinePrefix(view: EditorView, prefix: string | ((n: number) => string), keepBlank = false) {
  const { state } = view
  const lines = targetLines(state)
  let n = 0
  const changes = lines
    .filter((line) => lines.length === 1 || keepBlank || line.text.trim())
    .map((line) => {
      const p = typeof prefix === 'string' ? prefix : prefix(n++)
      return { ...prefixRange(line), insert: lines.length === 1 || line.text.trim() ? p : p.trimEnd() }
    })
  const set = state.changes(changes)
  const selection = lines.length === 1 ? state.selection.main.map(set, 1) : { anchor: set.mapPos(lines[0].from, -1), head: set.mapPos(lines[lines.length - 1].to, 1) }
  view.dispatch({ changes: set, selection })
}

/** Fence the target lines as a `lang` code block; on a blank line, insert `snippet` instead. */
function fence(view: EditorView, lang: string, snippet: string) {
  const { state } = view
  const lines = targetLines(state)
  const from = lines[0].from
  const to = lines[lines.length - 1].to
  if (!state.sliceDoc(from, to).trim()) return insertBlock(view, snippet)
  const open = '```' + lang + '\n'
  view.dispatch({
    changes: [
      { from, insert: open },
      { from: to, insert: '\n```' },
    ],
    selection: { anchor: from + open.length, head: to + open.length },
  })
}

/** Insert a block snippet on its own line; `¦` marks where the cursor ends up. */
function insertBlock(view: EditorView, snippet: string) {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)
  const before = line.text.trim() ? '\n' : ''
  const text = before + snippet.replace('¦', '')
  const caret = line.text.trim() ? line.to : line.from
  const offset = before.length + snippet.indexOf('¦')
  view.dispatch({
    changes: { from: line.text.trim() ? line.to : line.from, to: line.to, insert: text },
    selection: { anchor: caret + offset },
  })
}

/**
 * Wrap inline text: the selection when it is within one line, otherwise the text of each target line
 * (after its block prefix). On a blank line, insert `placeholder` wrapped.
 */
function wrapSelection(view: EditorView, left: string, right: string, placeholder: string) {
  const { state } = view
  const sel = state.selection.main
  const ranges =
    !sel.empty && state.doc.lineAt(sel.from).number === state.doc.lineAt(sel.to).number
      ? [{ from: sel.from, to: sel.to }]
      : targetLines(state)
          .map((line) => ({ from: prefixRange(line).to, to: line.from + line.text.trimEnd().length }))
          .filter((r) => r.to > r.from)
  if (!ranges.length) {
    return view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: left + placeholder + right },
      selection: { anchor: sel.from + left.length, head: sel.from + left.length + placeholder.length },
    })
  }
  const set = state.changes(ranges.flatMap((r) => [{ from: r.from, insert: left }, { from: r.to, insert: right }]))
  const first = ranges[0]
  const last = ranges[ranges.length - 1]
  // One range keeps its text selected; several select the whole span.
  view.dispatch({
    changes: set,
    selection: ranges.length === 1 ? { anchor: first.from + left.length, head: first.to + left.length } : { anchor: set.mapPos(first.from, -1), head: set.mapPos(last.to, 1) },
  })
}

function editTable(view: EditorView, fn: (m: ReturnType<typeof parseTable>) => void) {
  const range = tableRangeAt(view.state, view.state.selection.main.head)
  if (!range) return insertBlock(view, '| Column 1 | Column 2 |\n| -------- | -------- |\n| ¦        |          |')
  const model = parseTable(view.state.sliceDoc(range.from, range.to))
  fn(model)
  view.dispatch({ changes: { ...range, insert: serializeTable(model) } })
}

/**
 * Turn the selection, or the target lines, into a hidden note (`<!-- … -->`); on a blank line, insert an
 * empty one. Its source stays shown while the cursor is in it, so it can be written right away.
 */
function hiddenNote(view: EditorView) {
  const { state } = view
  const sel = state.selection.main
  const lines = targetLines(state)
  const oneLine = !sel.empty && lines.length === 1
  const from = oneLine ? sel.from : lines[0].from + (/^\s*/.exec(lines[0].text)?.[0].length ?? 0)
  const to = oneLine ? sel.to : lines[lines.length - 1].to
  const text = state.sliceDoc(from, to)
  const [open, close] = lines.length > 1 && !oneLine ? ['<!--\n', '\n-->'] : ['<!-- ', ' -->']
  view.dispatch({
    changes: { from, to, insert: open + text + close },
    selection: text.trim() ? { anchor: from + open.length, head: from + open.length + text.length } : { anchor: from + open.length },
    effects: showSource.of(from),
  })
}

/**
 * Mark the target lines as a region (`<!-- region:name:start -->` … `<!-- region:name:end -->`); on a
 * blank line, an empty one. Its name is selected in the start marker, shown to be typed over; the end
 * marker follows (see `regionSync`).
 */
function region(view: EditorView) {
  const { state } = view
  const lines = targetLines(state)
  const first = lines[0]
  const last = lines[lines.length - 1]
  const indent = /^\s*/.exec(first.text)![0]
  const blank = !state.sliceDoc(first.from, last.to).trim()
  const open = `${indent}<!-- region:section:start -->`
  const close = `${indent}<!-- region:section:end -->`
  const name = first.from + open.indexOf('section')
  view.dispatch({
    changes: blank ? { from: first.from, to: last.to, insert: `${open}\n${indent}\n${close}` } : [{ from: first.from, insert: open + '\n' }, { from: last.to, insert: '\n' + close }],
    selection: { anchor: name, head: name + 'section'.length },
    effects: showSource.of(first.from + indent.length),
  })
}

/** A tag for tools (`<!-- tag:name -->`) at the cursor, with its name selected to type over. */
function tagMarker(view: EditorView) {
  const at = view.state.selection.main.from
  const name = at + '<!-- tag:'.length
  view.dispatch({ changes: { from: at, insert: '<!-- tag:name -->' }, selection: { anchor: name, head: name + 4 }, effects: showSource.of(at) })
}

/** A checklist where only one option can be ticked: `<!-- choose: one -->` before it. */
function choiceList(view: EditorView) {
  setLinePrefix(view, '- [ ] ')
  const { state } = view
  const first = targetLines(state)[0]
  const changes = state.changes({ from: first.from, insert: `${/^\s*/.exec(first.text)![0]}<!-- choose: one -->\n` })
  view.dispatch({ changes, selection: state.selection.map(changes, 1) })
}

const today = () => new Date().toISOString().slice(0, 10)

const GROUPS: Group[] = [
  {
    label: 'menu.headings',
    icon: Heading,
    items: [
      { label: 'menu.h1', icon: Heading1, hint: '#', run: (v) => setLinePrefix(v, '# ') },
      { label: 'menu.h2', icon: Heading2, hint: '##', run: (v) => setLinePrefix(v, '## ') },
      { label: 'menu.h3', icon: Heading3, hint: '###', run: (v) => setLinePrefix(v, '### ') },
      { label: 'menu.h4', icon: Heading4, hint: '####', run: (v) => setLinePrefix(v, '#### ') },
    ],
  },
  {
    label: 'menu.lists',
    icon: List,
    items: [
      { label: 'menu.bullets', icon: List, hint: '-', run: (v) => setLinePrefix(v, '- ') },
      { label: 'menu.numbered', icon: ListOrdered, hint: '1.', run: (v) => setLinePrefix(v, (n) => `${n + 1}. `) },
      { label: 'menu.checklist', icon: ListChecks, hint: '- [ ]', run: (v) => setLinePrefix(v, '- [ ] ') },
      { label: 'menu.choice', icon: ListTodo, run: choiceList },
    ],
  },
  {
    label: 'menu.table',
    icon: Table,
    items: [
      { label: 'menu.newTable', icon: Table, run: (v) => insertBlock(v, '| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| ¦        |          |          |') },
      { label: 'menu.addRow', icon: Rows3, run: (v) => editTable(v, (m) => m.rows.push(m.header.map(() => ''))) },
      {
        label: 'menu.addCol',
        icon: Columns3,
        run: (v) =>
          editTable(v, (m) => {
            m.header.push(`Column ${m.header.length + 1}`)
            m.align.push('')
            m.rows.forEach((r) => r.push(''))
          }),
      },
    ],
  },
  {
    label: 'menu.code',
    icon: Code,
    items: [
      { label: 'menu.inline', icon: Code, hint: '`code`', run: (v) => wrapSelection(v, '`', '`', 'code') },
      { label: 'menu.block', icon: SquareCode, hint: '```', run: (v) => fence(v, '', '```\n¦\n```') },
      { label: 'menu.ts', icon: Braces, hint: 'ts', run: (v) => fence(v, 'ts', '```ts\n¦\n```') },
      { label: 'menu.bash', icon: Terminal, hint: 'bash', run: (v) => fence(v, 'bash', '```bash\n¦\n```') },
    ],
  },
  {
    label: 'menu.diagrams',
    icon: Workflow,
    items: [
      { label: 'menu.mermaid', icon: Workflow, run: (v) => fence(v, 'mermaid', '```mermaid\nflowchart LR\n  A[Start] --> B{Decision}\n  B -->|yes| C[¦Done]\n  B -->|no| A\n```') },
      { label: 'menu.sequence', icon: Network, run: (v) => fence(v, 'mermaid', '```mermaid\nsequenceDiagram\n  User->>App: request¦\n  App-->>User: response\n```') },
      { label: 'menu.tree', icon: FolderTree, run: (v) => fence(v, 'tree', '```tree\nsrc/\n  app/  # ¦description\n  lib/\n```') },
    ],
  },
  {
    label: 'menu.comments',
    icon: MessageSquare,
    items: [
      { label: 'menu.discussion', icon: MessageSquarePlus, run: addComment, when: (s) => !!s.facet(commentAuthor) },
      { label: 'menu.note', icon: EyeOff, hint: '<!-- -->', run: hiddenNote },
      { label: 'menu.region', icon: SquareDashed, hint: ':start/:end', run: region },
      { label: 'menu.tag', icon: Tag, hint: 'tag:', run: tagMarker },
    ],
  },
  {
    label: 'menu.other',
    icon: Ellipsis,
    items: [
      { label: 'menu.quote', icon: Quote, hint: '>', run: (v) => setLinePrefix(v, '> ', true) },
      { label: 'menu.link', icon: Link, hint: '[](…)', run: (v) => wrapSelection(v, '[', '](https://)', 'text') },
      { label: 'menu.divider', icon: Minus, hint: '---', run: (v) => insertBlock(v, '---\n¦') },
      {
        label: 'menu.frontmatter',
        icon: Braces,
        hint: 'yaml',
        run: (v) => {
          if (v.state.doc.sliceString(0, 4) === '---\n') return v.dispatch({ selection: { anchor: 4 } })
          const fm = `---\ntype: note\nstatus: pending\nupdated: ${today()}\n---\n\n`
          v.dispatch({ changes: { from: 0, insert: fm }, selection: { anchor: 9 } })
        },
      },
    ],
  },
]

// ------------------------------------------------------------ menu state

interface MenuState {
  /** Where the menu is anchored; when `slash`, the `/` that opened it sits here. */
  pos: number
  slash: boolean
  group: number | null
  active: number
}

const openMenu = StateEffect.define<MenuState>()
const setMenu = StateEffect.define<Partial<MenuState>>()
const closeMenu = StateEffect.define<null>()

const menuField = StateField.define<MenuState | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(openMenu)) return e.value
      if (e.is(closeMenu)) return null
      if (e.is(setMenu) && value) value = { ...value, ...e.value }
    }
    if (!value) return value
    if (tr.docChanged) return null
    const expected = value.slash ? value.pos + 1 : value.pos
    if (tr.selection && tr.state.selection.main.head !== expected) return null
    return value
  },
  provide: (f) => showTooltip.from(f, (m) => (m ? tooltipFor(m) : null)),
})

let translate: T = (k) => k

function tooltipFor(m: MenuState): Tooltip {
  return {
    pos: m.pos,
    above: false,
    create: (view) => {
      const dom = document.createElement('div')
      dom.className = 'cm-slash-menu'
      render(view, dom, m)
      return {
        dom,
        update: (u) => {
          const next = u.state.field(menuField)
          if (next) render(view, dom, next)
        },
      }
    },
  }
}

/** A group's items that apply in this state. */
const itemsOf = (state: EditorState, group: number) => GROUPS[group].items.filter((i) => !i.when || i.when(state))

function render(view: EditorView, dom: HTMLElement, m: MenuState) {
  const entries = m.group === null ? GROUPS.map((g) => ({ label: g.label, icon: g.icon, hint: '', sub: true })) : itemsOf(view.state, m.group).map((i) => ({ ...i, hint: i.hint ?? '', sub: false }))
  dom.replaceChildren()
  const head = document.createElement('div')
  head.className = 'cm-slash-head'
  head.textContent = m.group === null ? translate('menu.title') : translate(GROUPS[m.group].label)
  dom.append(head)
  entries.forEach((e, i) => {
    const row = document.createElement('div')
    row.className = 'cm-slash-item' + (i === m.active ? ' active' : '')
    const num = document.createElement('span')
    num.className = 'cm-slash-num'
    num.textContent = String(i + 1)
    const icon = createElement(e.icon, { width: 16, height: 16, 'stroke-width': 1.75 } as any)
    icon.classList.add('cm-slash-icon')
    const label = document.createElement('span')
    label.className = 'cm-slash-label'
    label.textContent = translate(e.label)
    const hint = document.createElement('span')
    hint.className = 'cm-slash-hint'
    hint.textContent = e.sub ? '›' : e.hint
    row.append(num, icon, label, hint)
    row.addEventListener('mousedown', (ev) => {
      ev.preventDefault()
      choose(view, i)
    })
    row.addEventListener('mousemove', () => {
      if (view.state.field(menuField)?.active !== i) view.dispatch({ effects: setMenu.of({ active: i }) })
    })
    dom.append(row)
  })
  if (m.group !== null) {
    const foot = document.createElement('div')
    foot.className = 'cm-slash-foot'
    foot.textContent = translate('menu.back')
    dom.append(foot)
  }
}

function entryCount(state: EditorState, m: MenuState) {
  return m.group === null ? GROUPS.length : itemsOf(state, m.group).length
}

function choose(view: EditorView, index: number) {
  const m = view.state.field(menuField)
  if (!m || index < 0 || index >= entryCount(view.state, m)) return false
  if (m.group === null) {
    view.dispatch({ effects: setMenu.of({ group: index, active: 0 }) })
    return true
  }
  const item = itemsOf(view.state, m.group)[index]
  // Remove the `/` first (this also closes the menu), then run the item.
  if (m.slash) view.dispatch({ changes: { from: m.pos, to: m.pos + 1 }, selection: { anchor: m.pos } })
  else view.dispatch({ effects: closeMenu.of(null) })
  item.run(view)
  view.focus()
  return true
}

/** Leave a submenu for the group list, with that group highlighted. */
function back(view: EditorView) {
  const m = view.state.field(menuField)
  if (!m || m.group === null) return false
  view.dispatch({ effects: setMenu.of({ group: null, active: m.group }) })
  return true
}

const isLineStart = (state: EditorState, pos: number) => !state.doc.lineAt(pos).text.slice(0, pos - state.doc.lineAt(pos).from).trim()

const slashInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '/' || from !== to || !isLineStart(view.state, from)) return false
  view.dispatch({ changes: { from, insert: '/' }, selection: { anchor: from + 1 }, userEvent: 'input.type' })
  view.dispatch({ effects: openMenu.of({ pos: from, slash: true, group: null, active: 0 }) })
  return true
})

const menuKeys = Prec.highest(
  keymap.of([
    {
      key: 'Ctrl-Space',
      run: (view) => {
        view.dispatch({ effects: openMenu.of({ pos: view.state.selection.main.head, slash: false, group: null, active: 0 }) })
        return true
      },
    },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((key) => ({
      key,
      run: (view: EditorView) => (view.state.field(menuField) ? choose(view, Number(key) - 1) : false),
    })),
    {
      key: 'ArrowDown',
      run: (view) => {
        const m = view.state.field(menuField)
        if (!m) return false
        view.dispatch({ effects: setMenu.of({ active: (m.active + 1) % entryCount(view.state, m) }) })
        return true
      },
    },
    {
      key: 'ArrowUp',
      run: (view) => {
        const m = view.state.field(menuField)
        if (!m) return false
        view.dispatch({ effects: setMenu.of({ active: (m.active - 1 + entryCount(view.state, m)) % entryCount(view.state, m) }) })
        return true
      },
    },
    { key: 'Enter', run: (view) => (view.state.field(menuField) ? choose(view, view.state.field(menuField)!.active) : false) },
    { key: 'ArrowRight', run: (view) => (view.state.field(menuField)?.group === null ? choose(view, view.state.field(menuField)!.active) : false) },
    { key: '0', run: back },
    { key: 'ArrowLeft', run: back },
    { key: 'Backspace', run: back },
    {
      key: 'Escape',
      run: (view) => {
        if (!view.state.field(menuField)) return false
        view.dispatch({ effects: closeMenu.of(null) })
        return true
      },
    },
  ]),
)

export function slashMenu(t: T) {
  translate = t
  return [menuField, slashInput, menuKeys]
}
