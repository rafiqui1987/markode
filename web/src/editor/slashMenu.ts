import { type EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import {
  Braces,
  Code,
  Columns3,
  createElement,
  Ellipsis,
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
  Minus,
  Network,
  Quote,
  Rows3,
  SquareCode,
  Table,
  Terminal,
  Workflow,
} from 'lucide'
import type { T, TKey } from '../i18n'
import { parseTable, serializeTable, tableRangeAt } from './table'

interface Item {
  label: TKey
  icon: IconNode
  hint?: string
  run: (view: EditorView) => void
}
interface Group {
  label: TKey
  icon: IconNode
  items: Item[]
}

// ------------------------------------------------------------ edit helpers

const LINE_PREFIX = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)?/

/** Replace whatever block prefix the cursor line has (heading, list, quote) with `prefix`. */
function setLinePrefix(view: EditorView, prefix: string) {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)
  const m = LINE_PREFIX.exec(line.text)!
  const from = line.from + m[1].length
  const to = from + (m[2]?.length ?? 0)
  const head = state.selection.main.head
  view.dispatch({
    changes: { from, to, insert: prefix },
    selection: { anchor: Math.max(head + prefix.length - (to - from), from + prefix.length) },
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

function wrapSelection(view: EditorView, left: string, right: string, placeholder: string) {
  const { from, to } = view.state.selection.main
  const inner = view.state.sliceDoc(from, to) || placeholder
  view.dispatch({
    changes: { from, to, insert: left + inner + right },
    selection: { anchor: from + left.length, head: from + left.length + inner.length },
  })
}

function editTable(view: EditorView, fn: (m: ReturnType<typeof parseTable>) => void) {
  const range = tableRangeAt(view.state, view.state.selection.main.head)
  if (!range) return insertBlock(view, '| Column 1 | Column 2 |\n| -------- | -------- |\n| ¦        |          |')
  const model = parseTable(view.state.sliceDoc(range.from, range.to))
  fn(model)
  view.dispatch({ changes: { ...range, insert: serializeTable(model) } })
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
      { label: 'menu.numbered', icon: ListOrdered, hint: '1.', run: (v) => setLinePrefix(v, '1. ') },
      { label: 'menu.checklist', icon: ListChecks, hint: '- [ ]', run: (v) => setLinePrefix(v, '- [ ] ') },
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
      { label: 'menu.block', icon: SquareCode, hint: '```', run: (v) => insertBlock(v, '```\n¦\n```') },
      { label: 'menu.ts', icon: Braces, hint: 'ts', run: (v) => insertBlock(v, '```ts\n¦\n```') },
      { label: 'menu.bash', icon: Terminal, hint: 'bash', run: (v) => insertBlock(v, '```bash\n¦\n```') },
    ],
  },
  {
    label: 'menu.diagrams',
    icon: Workflow,
    items: [
      { label: 'menu.mermaid', icon: Workflow, run: (v) => insertBlock(v, '```mermaid\nflowchart LR\n  A[Start] --> B{Decision}\n  B -->|yes| C[¦Done]\n  B -->|no| A\n```') },
      { label: 'menu.sequence', icon: Network, run: (v) => insertBlock(v, '```mermaid\nsequenceDiagram\n  User->>App: request¦\n  App-->>User: response\n```') },
      { label: 'menu.tree', icon: FolderTree, run: (v) => insertBlock(v, '```tree\nsrc/\n  app/  # ¦description\n  lib/\n```') },
    ],
  },
  {
    label: 'menu.other',
    icon: Ellipsis,
    items: [
      { label: 'menu.quote', icon: Quote, hint: '>', run: (v) => setLinePrefix(v, '> ') },
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

function render(view: EditorView, dom: HTMLElement, m: MenuState) {
  const entries = m.group === null ? GROUPS.map((g) => ({ label: g.label, icon: g.icon, hint: '', sub: true })) : GROUPS[m.group].items.map((i) => ({ ...i, hint: i.hint ?? '', sub: false }))
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

function entryCount(m: MenuState) {
  return m.group === null ? GROUPS.length : GROUPS[m.group].items.length
}

function choose(view: EditorView, index: number) {
  const m = view.state.field(menuField)
  if (!m || index < 0 || index >= entryCount(m)) return false
  if (m.group === null) {
    view.dispatch({ effects: setMenu.of({ group: index, active: 0 }) })
    return true
  }
  const item = GROUPS[m.group].items[index]
  // Remove the `/` first (this also closes the menu), then run the item.
  if (m.slash) view.dispatch({ changes: { from: m.pos, to: m.pos + 1 }, selection: { anchor: m.pos } })
  else view.dispatch({ effects: closeMenu.of(null) })
  item.run(view)
  view.focus()
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
        view.dispatch({ effects: setMenu.of({ active: (m.active + 1) % entryCount(m) }) })
        return true
      },
    },
    {
      key: 'ArrowUp',
      run: (view) => {
        const m = view.state.field(menuField)
        if (!m) return false
        view.dispatch({ effects: setMenu.of({ active: (m.active - 1 + entryCount(m)) % entryCount(m) }) })
        return true
      },
    },
    { key: 'Enter', run: (view) => (view.state.field(menuField) ? choose(view, view.state.field(menuField)!.active) : false) },
    { key: 'ArrowRight', run: (view) => (view.state.field(menuField)?.group === null ? choose(view, view.state.field(menuField)!.active) : false) },
    {
      key: 'Backspace',
      run: (view) => {
        const m = view.state.field(menuField)
        if (!m || m.group === null) return false
        view.dispatch({ effects: setMenu.of({ group: null, active: m.group }) })
        return true
      },
    },
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
