import { StateEffect } from '@codemirror/state'
import { type EditorView, WidgetType } from '@codemirror/view'
import { createElement, EyeOff, Globe, type IconNode, Tag } from 'lucide'
import type { T } from '../i18n'
import { parseTable, serializeTable, tableRangeAt, type TableModel } from './table'
import { toggleTaskAt } from './comments'

let translate: T = (k) => k
export function setWidgetTranslate(t: T) {
  translate = t
}

/** Show the Markdown source of the element at this position until the cursor leaves it (see livePreview). */
export const showSource = StateEffect.define<number>()

/** Show the widget's source and move the cursor into it. */
function revealSource(view: EditorView, dom: HTMLElement) {
  const pos = view.posAtDOM(dom)
  view.dispatch({ effects: showSource.of(pos), selection: { anchor: Math.min(pos + 3, view.state.doc.length) } })
  view.focus()
}

const observers = new WeakMap<HTMLElement, ResizeObserver[]>()

function observe(dom: HTMLElement, target: HTMLElement, onResize: () => void) {
  const observer = new ResizeObserver(onResize)
  observer.observe(target)
  observers.set(dom, [...(observers.get(dom) ?? []), observer])
}

/** Disconnects the observers of a widget's DOM; call from `WidgetType.destroy`. */
function unobserve(dom: HTMLElement) {
  for (const o of observers.get(dom) ?? []) o.disconnect()
  observers.delete(dom)
}

/**
 * Make CodeMirror re-measure line heights. `requestMeasure` alone skips them when the document's
 * total height looks unchanged (short documents fill the editor), and a stale height map sends
 * clicks below the widget to the wrong line. There is no public API for this.
 */
function remeasure(view: EditorView) {
  ;(view as unknown as { viewState: { mustMeasureContent: boolean } }).viewState.mustMeasureContent = true
  view.requestMeasure()
}

/**
 * Wraps a block widget: vertical spacing goes here as padding (CodeMirror's height map ignores
 * margins), and any size change of the widget (async diagrams, column resizes) triggers a re-measure.
 */
function blockOuter(view: EditorView, inner: HTMLElement) {
  const outer = document.createElement('div')
  outer.className = 'cm-block-outer'
  outer.append(inner)
  observe(outer, outer, () => remeasure(view))
  return outer
}

/**
 * Clicking an inline widget puts the cursor on it, revealing its source. CodeMirror can't map a
 * click inside such a widget to a position on its own (it lands at the start of the document).
 */
function clickToReveal(view: EditorView, dom: HTMLElement) {
  dom.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const pos = view.posAtDOM(dom)
    view.dispatch({ effects: showSource.of(pos), selection: { anchor: pos } })
    view.focus()
  })
}

function editButton(view: EditorView, wrap: HTMLElement) {
  const btn = document.createElement('button')
  btn.className = 'cm-widget-edit'
  btn.title = 'Edit source'
  btn.textContent = '</>'
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    revealSource(view, wrap)
  })
  return btn
}

// ---------------------------------------------------------------- mermaid

let mermaidSeq = 0
let mermaidReady: Promise<typeof import('mermaid').default> | null = null
let mermaidTheme: Theme | null = null
/** Rendered SVG per theme and diagram, and the latest one per diagram in any theme. */
const svgCache = new Map<string, string>()
const lastSvg = new Map<string, string>()

export type Theme = 'light' | 'dark'

function loadMermaid(theme: Theme) {
  if (!mermaidReady || mermaidTheme !== theme) {
    mermaidTheme = theme
    mermaidReady = import('mermaid').then((m) => {
      // Diagram colors follow the app palette instead of mermaid's own themes.
      const css = getComputedStyle(document.documentElement)
      const v = (name: string) => css.getPropertyValue(name).trim()
      m.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: 'Inter, system-ui, sans-serif',
        themeVariables: {
          darkMode: theme === 'dark',
          fontSize: '15px',
          background: v('--panel'),
          primaryColor: v('--panel-2'),
          primaryTextColor: v('--text'),
          primaryBorderColor: v('--accent'),
          secondaryColor: v('--panel-2'),
          tertiaryColor: v('--panel'),
          lineColor: v('--muted'),
          textColor: v('--text'),
          edgeLabelBackground: v('--panel'),
          actorBkg: v('--panel-2'),
          actorBorder: v('--accent'),
          actorTextColor: v('--text'),
          signalColor: v('--muted'),
          signalTextColor: v('--text'),
          noteBkgColor: v('--panel-2'),
          noteTextColor: v('--text'),
        },
      })
      return m.default
    })
  }
  return mermaidReady
}

/** A diagram for print: mermaid's own light theme; the editor's palette is set again on its next render. */
export async function printMermaidSvg(code: string): Promise<string> {
  const m = (await import('mermaid')).default
  m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', fontFamily: 'Inter, system-ui, sans-serif' })
  try {
    return (await m.render(`markode-print-${++mermaidSeq}`, code)).svg
  } finally {
    mermaidReady = null
    mermaidTheme = null
  }
}

export class MermaidWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly theme: Theme,
  ) {
    super()
  }
  eq(other: MermaidWidget) {
    return other.code === this.code && other.theme === this.theme
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-block-widget cm-mermaid'
    const out = document.createElement('div')
    wrap.append(editButton(view, wrap), out)
    wrap.addEventListener('dblclick', () => revealSource(view, wrap))
    const key = `${this.theme}\n${this.code}`
    const cached = svgCache.get(key)
    if (cached) out.innerHTML = cached
    else {
      // Until it renders, show this diagram in the other theme (if any) so the height doesn't jump.
      const stale = lastSvg.get(this.code)
      if (stale) out.innerHTML = stale
      else out.textContent = '…'
      loadMermaid(this.theme)
        .then((m) => m.render(`markode-mermaid-${++mermaidSeq}`, this.code))
        .then(({ svg }) => {
          svgCache.set(key, svg)
          lastSvg.set(this.code, svg)
          out.innerHTML = svg
        })
        .catch((err) => {
          out.className = 'cm-widget-error'
          out.textContent = String(err?.message ?? err)
        })
    }
    return blockOuter(view, wrap)
  }
  destroy(dom: HTMLElement) {
    unobserve(dom)
  }
  ignoreEvent() {
    return true
  }
}

// ---------------------------------------------------------------- math

let katex: typeof import('katex').default | null = null
let katexReady: Promise<typeof import('katex').default> | null = null

function loadKatex() {
  katexReady ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => (katex = m.default))
  return katexReady
}

/** KaTeX math; display math is a block with an edit button, inline math reveals its source on click. */
export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super()
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display
  }
  toDOM(view: EditorView) {
    const out = document.createElement(this.display ? 'div' : 'span')
    out.className = this.display ? 'cm-math-display' : 'cm-math-inline'
    const render = (k: typeof import('katex').default) => k.render(this.tex, out, { displayMode: this.display, throwOnError: false })
    if (katex) render(katex)
    else {
      out.textContent = this.tex
      // Inline math changes its line's size once rendered; display math has its own observer.
      loadKatex().then((k) => (render(k), this.display || remeasure(view)))
    }
    if (!this.display) {
      clickToReveal(view, out)
      return out
    }
    const wrap = document.createElement('div')
    wrap.className = 'cm-block-widget cm-math'
    wrap.append(editButton(view, wrap), out)
    wrap.addEventListener('dblclick', () => revealSource(view, wrap))
    return blockOuter(view, wrap)
  }
  destroy(dom: HTMLElement) {
    unobserve(dom)
  }
  ignoreEvent() {
    return true
  }
}

// ---------------------------------------------------------------- images

/** Where an image `src` loads from: remote URLs as-is, project paths through the server, relative to the document. */
export function imageUrl(src: string, docPath: string): string {
  if (/^([a-z][a-z\d+.-]*:|\/\/)/i.test(src)) return src
  const dir = docPath.split('/').slice(0, -1).join('/')
  const rel = decodeURIComponent(new URL(src, `http://project/${dir ? dir + '/' : ''}`).pathname.slice(1))
  return `/api/asset?path=${encodeURIComponent(rel)}`
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly title: string,
  ) {
    super()
  }
  eq(other: ImageWidget) {
    return other.url === this.url && other.alt === this.alt && other.title === this.title
  }
  toDOM(view: EditorView) {
    // A fixed root: replacing the widget's own element would make CodeMirror read it as typed text.
    const wrap = document.createElement('span')
    wrap.className = 'cm-image-wrap'
    const img = document.createElement('img')
    img.className = 'cm-image'
    img.src = this.url
    img.alt = this.alt
    img.title = this.title || this.alt
    // The line grows once the image arrives; a broken one shows its alt text instead.
    img.addEventListener('load', () => remeasure(view))
    img.addEventListener('error', () => {
      wrap.className = 'cm-image-wrap cm-image-broken'
      wrap.title = this.url
      wrap.textContent = `⚠ ${this.alt || this.url}`
      remeasure(view)
    })
    wrap.append(img)
    clickToReveal(view, wrap)
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

// ---------------------------------------------------------------- footnotes

/** A footnote reference as a superscript number; hovering shows the note. */
export class FootnoteRefWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly note: string,
  ) {
    super()
  }
  eq(other: FootnoteRefWidget) {
    return other.label === this.label && other.note === this.note
  }
  toDOM(view: EditorView) {
    const sup = document.createElement('sup')
    sup.className = 'cm-footnote-ref'
    sup.textContent = this.label
    if (this.note) sup.title = this.note
    clickToReveal(view, sup)
    return sup
  }
  ignoreEvent() {
    return true
  }
}

/** The `[^label]:` marker that starts a footnote definition. */
export class FootnoteDefWidget extends WidgetType {
  constructor(readonly label: string) {
    super()
  }
  eq(other: FootnoteDefWidget) {
    return other.label === this.label
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-footnote-label'
    s.textContent = this.label
    return s
  }
}

// ---------------------------------------------------------------- tree

interface TreeItem {
  label: string
  note: string
  children: TreeItem[]
}

/** Accepts indented lines or the output of the `tree` command. */
export function parseTreeBlock(code: string): TreeItem[] {
  const lines = code.split('\n').filter((l) => l.trim() && !/^\s*\d+ director(y|ies)/.test(l))
  const parsed = lines.map((l) => {
    const prefix = l.match(/^[\s│├└─|`\-+]*/)![0]
    const [label, ...note] = l.slice(prefix.length).split(/\s{2,}#\s?/)
    return { width: [...prefix].length, label: label.trim(), note: note.join(' # ').trim() }
  })
  const widths = [...new Set(parsed.map((p) => p.width))].sort((a, b) => a - b)
  const root: TreeItem[] = []
  const stack: { depth: number; item: TreeItem }[] = []
  for (const p of parsed) {
    const depth = widths.indexOf(p.width)
    const item = { label: p.label, note: p.note, children: [] }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    ;(stack.length ? stack[stack.length - 1].item.children : root).push(item)
    stack.push({ depth, item })
  }
  return root
}

function renderTree(items: TreeItem[]): HTMLElement {
  const ul = document.createElement('ul')
  for (const it of items) {
    const li = document.createElement('li')
    const isDir = it.children.length > 0 || it.label.endsWith('/')
    const row = document.createElement('span')
    row.className = 'cm-tree-row'
    row.innerHTML = `<span class="cm-tree-icon">${isDir ? '▾' : '•'}</span>`
    const name = document.createElement('span')
    name.className = isDir ? 'cm-tree-dir' : 'cm-tree-file'
    name.textContent = it.label
    row.append(name)
    if (it.note) {
      const note = document.createElement('span')
      note.className = 'cm-tree-note'
      note.textContent = it.note
      row.append(note)
    }
    li.append(row)
    if (it.children.length) {
      const sub = renderTree(it.children)
      li.append(sub)
      row.classList.add('cm-tree-toggle')
      row.addEventListener('click', () => {
        const collapsed = li.classList.toggle('collapsed')
        row.querySelector('.cm-tree-icon')!.textContent = collapsed ? '▸' : '▾'
      })
    }
    ul.append(li)
  }
  return ul
}

export class TreeWidget extends WidgetType {
  constructor(readonly code: string) {
    super()
  }
  eq(other: TreeWidget) {
    return other.code === this.code
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-block-widget cm-tree'
    wrap.append(editButton(view, wrap), renderTree(parseTreeBlock(this.code)))
    return blockOuter(view, wrap)
  }
  destroy(dom: HTMLElement) {
    unobserve(dom)
  }
  ignoreEvent() {
    return true
  }
}

// ---------------------------------------------------------------- table

let closeMenu: (() => void) | null = null

/** A small context menu at the pointer; closes on outside click, Escape, scroll or blur. */
export function showMenu(x: number, y: number, items: { label: string; run: () => void }[]) {
  closeMenu?.()
  const menu = document.createElement('div')
  menu.className = 'cm-slash-menu cm-context-menu'
  for (const it of items) {
    const row = document.createElement('div')
    row.className = 'cm-slash-item'
    row.textContent = it.label
    row.addEventListener('mousedown', (e) => {
      e.preventDefault()
      closeMenu?.()
      it.run()
    })
    menu.append(row)
  }
  document.body.append(menu)
  const { width, height } = menu.getBoundingClientRect()
  menu.style.left = `${Math.min(x, innerWidth - width - 8)}px`
  menu.style.top = `${Math.min(y, innerHeight - height - 8)}px`
  const onDown = (e: Event) => !menu.contains(e.target as Node) && closeMenu?.()
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu?.()
  const close = () => closeMenu?.()
  closeMenu = () => {
    menu.remove()
    removeEventListener('mousedown', onDown, true)
    removeEventListener('keydown', onKey, true)
    removeEventListener('scroll', close, true)
    removeEventListener('blur', close)
    closeMenu = null
  }
  addEventListener('mousedown', onDown, true)
  addEventListener('keydown', onKey, true)
  addEventListener('scroll', close, true)
  addEventListener('blur', close)
}

function insertColumn(m: TableModel, at: number) {
  m.header.splice(at, 0, `col ${m.header.length + 1}`)
  m.align.splice(at, 0, '')
  m.rows.forEach((r) => r.splice(at, 0, ''))
}

// Column widths are view-only (Markdown can't store them): fractions of the table width, kept per browser and keyed by the header row.
const WIDTHS_KEY = 'markode.tableWidths'
const widthsKey = (header: string[]) => header.join('|')

function loadWidths(header: string[]): number[] | null {
  try {
    const w = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? '{}')[widthsKey(header)]
    return Array.isArray(w) && w.length === header.length ? normalize(w) : null
  } catch {
    return null
  }
}

function saveWidths(header: string[], widths: number[] | null) {
  try {
    const all = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? '{}')
    if (widths) all[widthsKey(header)] = widths
    else delete all[widthsKey(header)]
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(all))
  } catch {}
}

const normalize = (w: number[]) => {
  const sum = w.reduce((a, b) => a + b, 0)
  return w.map((x) => x / sum)
}

const DEL_COL = 28
/** Narrowest a column gets; keep in sync with the cells' min-width in styles.css. */
const MIN_COL = 80
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Minimal inline Markdown for table cells: code, bold, italic, strike, links. */
function renderInline(md: string): string {
  const code: string[] = []
  let html = escapeHtml(md.replace(/\\\|/g, '|')).replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`)
  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="cm-link-text">$1</span>')
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code class="cm-inline-code">${code[Number(i)]}</code>`)
}

export class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }
  eq(other: TableWidget) {
    return other.source === this.source
  }

  toDOM(view: EditorView) {
    const model = parseTable(this.source)
    const wrap = document.createElement('div')
    wrap.className = 'cm-block-widget cm-table-widget'
    let widths = loadWidths(model.header)

    const commit = (next: TableModel) => {
      const range = tableRangeAt(view.state, view.posAtDOM(wrap))
      if (!range) return
      if (widths?.length === next.header.length) saveWidths(next.header, widths)
      const text = serializeTable(next)
      if (text !== view.state.sliceDoc(range.from, range.to)) view.dispatch({ changes: { ...range, insert: text } })
    }
    const read = (): TableModel => {
      const cells = (tr: Element) => [...tr.querySelectorAll<HTMLElement>('[data-cell]')].map((c) => (c.dataset.raw ?? '').trim())
      const trs = [...wrap.querySelectorAll('tr')]
      return { header: cells(trs[0]), align: model.align, rows: trs.slice(1).map(cells) }
    }

    const table = document.createElement('table')
    const makeRow = (cells: string[], header: boolean, rowIndex: number) => {
      const tr = document.createElement('tr')
      cells.forEach((text, col) => {
        const cell = document.createElement(header ? 'th' : 'td')
        cell.dataset.cell = ''
        cell.dataset.raw = text
        cell.contentEditable = 'true'
        cell.spellcheck = false
        cell.innerHTML = renderInline(text)
        if (model.align[col]) cell.style.textAlign = model.align[col]
        // Rendered while idle, raw Markdown while editing.
        cell.addEventListener('focus', () => (cell.textContent = cell.dataset.raw ?? ''))
        cell.addEventListener('input', () => (cell.dataset.raw = cell.textContent ?? ''))
        cell.addEventListener('blur', () => {
          cell.innerHTML = renderInline(cell.dataset.raw ?? '')
          commit(read())
        })
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            const next = read()
            if (!header && rowIndex === next.rows.length - 1) next.rows.push(next.header.map(() => ''))
            commit(next)
          } else if (e.key === 'Escape') cell.blur()
        })
        // Replaces the browser menu: columns from the header, rows from body cells.
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          const edit = (fn: (m: TableModel) => void) => () => {
            const next = read()
            fn(next)
            commit(next)
          }
          const emptyRow = (m: TableModel) => m.header.map(() => '')
          const items = header
            ? [
                { label: translate('table.colLeft'), run: edit((m) => addColumn(m, col)) },
                { label: translate('table.colRight'), run: edit((m) => addColumn(m, col + 1)) },
                ...(model.header.length > 1 ? [{ label: translate('table.deleteCol'), run: edit((m) => removeColumn(m, col)) }] : []),
              ]
            : [
                { label: translate('table.rowAbove'), run: edit((m) => m.rows.splice(rowIndex, 0, emptyRow(m))) },
                { label: translate('table.rowBelow'), run: edit((m) => m.rows.splice(rowIndex + 1, 0, emptyRow(m))) },
                { label: translate('table.deleteRow'), run: edit((m) => m.rows.splice(rowIndex, 1)) },
              ]
          showMenu(e.clientX, e.clientY, items)
        })
        tr.append(cell)
      })
      if (!header) {
        const del = document.createElement('td')
        del.className = 'cm-table-del'
        del.textContent = '×'
        del.title = 'Delete row'
        del.addEventListener('mousedown', (e) => {
          e.preventDefault()
          const next = read()
          next.rows.splice(rowIndex, 1)
          commit(next)
        })
        tr.append(del)
      } else tr.append(document.createElement('th'))
      return tr
    }
    const cols = model.header.map(() => document.createElement('col'))
    const delCol = document.createElement('col')
    delCol.style.width = `${DEL_COL}px`
    const colgroup = document.createElement('colgroup')
    colgroup.append(...cols, delCol)
    table.append(colgroup, makeRow(model.header, true, -1), ...model.rows.map((r, i) => makeRow(r, false, i)))

    // Drag the border between two columns to move space from one to the other (the table keeps
    // its width); double-click resets every column to automatic.
    // Measured on the container, not the table: reading the table back would let rounding grow it on every move.
    const available = () => Math.max(1, wrap.clientWidth - DEL_COL)
    // Width the columns share: the container, or more when they can't all get MIN_COL (then the table scrolls inside its box).
    const span = () => Math.max(available(), cols.length * MIN_COL)
    const handles = model.header.slice(1).map((_, i) => {
      const h = document.createElement('div')
      h.className = 'cm-col-resize'
      h.addEventListener('mousedown', (e) => {
        e.preventDefault()
        if (!widths) widths = normalize([...table.rows[0].cells].slice(0, cols.length).map((c) => c.offsetWidth))
        const start = e.clientX
        const pair = widths[i] + widths[i + 1]
        const base = widths[i]
        h.classList.add('active')
        const move = (ev: MouseEvent) => {
          const min = Math.min(MIN_COL / span(), pair / 2)
          widths![i] = Math.min(pair - min, Math.max(min, base + (ev.clientX - start) / span()))
          widths![i + 1] = pair - widths![i]
          applyWidths()
        }
        const up = () => {
          h.classList.remove('active')
          removeEventListener('mousemove', move)
          removeEventListener('mouseup', up)
          saveWidths(read().header, widths)
        }
        addEventListener('mousemove', move)
        addEventListener('mouseup', up)
      })
      h.addEventListener('dblclick', () => {
        widths = null
        saveWidths(read().header, null)
        applyWidths()
      })
      return h
    })
    const placeHandles = () => {
      const ths = table.rows[0].cells
      handles.forEach((h, i) => {
        h.style.left = `${table.offsetLeft + ths[i].offsetLeft + ths[i].offsetWidth - 3}px`
        h.style.top = `${table.offsetTop}px`
        h.style.height = `${table.offsetHeight}px`
      })
    }
    const applyWidths = () => {
      table.classList.toggle('cm-table-sized', !!widths)
      // The last column takes whatever is left, so the table never exceeds what the columns share.
      cols.forEach((c, i) => (c.style.width = widths && i < cols.length - 1 ? `${Math.max(MIN_COL, widths[i] * span())}px` : ''))
      table.style.width = widths && span() > available() ? `${span() + DEL_COL}px` : ''
      placeHandles()
    }
    applyWidths()
    const removeColumn = (m: TableModel, at: number) => {
      for (const r of [m.header, m.align, ...m.rows]) r.splice(at, 1)
      if (widths) {
        widths.splice(at, 1)
        widths = normalize(widths)
      }
    }
    const addColumn = (m: TableModel, at: number) => {
      insertColumn(m, at)
      if (widths) {
        widths.splice(at, 0, 1 / widths.length)
        widths = normalize(widths)
      }
    }

    wrap.append(editButton(view, wrap), table, ...handles)
    const outer = blockOuter(view, wrap)
    observe(outer, wrap, applyWidths)
    return outer
  }

  destroy(dom: HTMLElement) {
    unobserve(dom)
  }

  ignoreEvent() {
    return true
  }
}

// ---------------------------------------------------------------- inline

export class CheckboxWidget extends WidgetType {
  /** `radio`: the task is in a single-choice list (`<!-- choose: one -->`). */
  constructor(
    readonly checked: boolean,
    readonly radio = false,
  ) {
    super()
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.radio === this.radio
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = `cm-task-box${this.radio ? ' cm-task-radio' : ''}`
    box.checked = this.checked
    box.addEventListener('mousedown', (e) => e.preventDefault())
    box.addEventListener('click', (e) => {
      e.preventDefault()
      toggleTaskAt(view, view.posAtDOM(box))
    })
    return box
  }
  ignoreEvent() {
    return true
  }
}

/** Shown instead of `<!-- choose: one -->`: the list below is single choice. */
export class ChoiceLabelWidget extends WidgetType {
  constructor(readonly label: string) {
    super()
  }
  eq(other: ChoiceLabelWidget) {
    return other.label === this.label
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-choice-label'
    s.textContent = this.label
    return s
  }
}

/** Shown instead of a code block's opening fence: just its language. */
export class CodeLangWidget extends WidgetType {
  constructor(readonly lang: string) {
    super()
  }
  eq(other: CodeLangWidget) {
    return other.lang === this.lang
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-code-lang'
    s.textContent = this.lang
    return s
  }
}

export class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-bullet'
    s.textContent = '•'
    return s
  }
}

export class RuleWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-hr'
    return s
  }
}

// ---------------------------------------------------------------- HTML comments

function icon(node: IconNode) {
  return createElement(node, { width: 13, height: 13, 'stroke-width': 1.75 } as any)
}

/**
 * A note in an HTML comment (`<!-- … -->`): hidden when the Markdown is rendered elsewhere, but read by
 * agents. A subtle icon that shows the text on hover; a click shows the comment to edit it.
 */
export class NoteWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: NoteWidget) {
    return other.text === this.text
  }
  toDOM(view: EditorView) {
    const s = document.createElement('span')
    s.className = 'cm-note'
    s.title = `${translate('comment.note')}\n\n${this.text}`
    s.append(icon(EyeOff))
    clickToReveal(view, s)
    return s
  }
}

/** A marker a tool reads (`<!-- markode:source-lang:es -->`, `<!-- rule:pnpm-only -->`): a small chip. */
export class MarkerWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly title: string,
    readonly lang: boolean,
  ) {
    super()
  }
  eq(other: MarkerWidget) {
    return other.label === this.label && other.title === this.title
  }
  toDOM(view: EditorView) {
    const s = document.createElement('span')
    s.className = this.lang ? 'cm-marker cm-marker-chip' : 'cm-marker'
    s.title = this.title
    s.append(icon(this.lang ? Globe : Tag))
    if (this.lang) s.append(this.label)
    clickToReveal(view, s)
    return s
  }
}

/** The start of a region a tool manages (`<!-- markode:rules:start -->`): its label, opening a bracket. */
export class RegionStartWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly title: string,
  ) {
    super()
  }
  eq(other: RegionStartWidget) {
    return other.label === this.label && other.title === this.title
  }
  toDOM(view: EditorView) {
    const s = document.createElement('span')
    s.className = 'cm-region-label'
    s.textContent = this.label
    s.title = this.title
    clickToReveal(view, s)
    return s
  }
}
