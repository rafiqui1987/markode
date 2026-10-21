import { syntaxTree } from '@codemirror/language'
import { Prec, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, showTooltip } from '@codemirror/view'
import type { T } from '../i18n'
import { serializeTable } from './table'

const KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥H' : 'Alt+H'

/** Tab-separated rows as spreadsheets copy them; quoted cells may hold tabs, newlines and `""`. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let start = true
  const s = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (start && c === '"') {
      quoted = true
      start = false
    } else if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '\t' || c === '\n') {
      row.push(cell)
      cell = ''
      start = true
      if (c === '\n') {
        rows.push(row)
        row = []
      }
    } else {
      cell += c
      start = false
    }
  }
  if (cell || row.length) rows.push([...row, cell])
  while (rows.length && rows[rows.length - 1].every((c) => !c.trim())) rows.pop()
  return rows.map((r) => r.map((c) => c.replace(/\s*\n\s*/g, ' ').trim()))
}

function toMarkdown(rows: string[][], header: boolean): string {
  const cols = Math.max(...rows.map((r) => r.length))
  const pad = (r: string[]) => [...r, ...Array(cols - r.length).fill('')]
  const head = header ? pad(rows[0]) : Array.from({ length: cols }, (_, i) => `col ${i + 1}`)
  return serializeTable({ header: head, align: head.map(() => ''), rows: (header ? rows.slice(1) : rows).map(pad) })
}

interface Pasted {
  from: number
  to: number
  rows: string[][]
  header: boolean
}

const setPasted = StateEffect.define<Pasted | null>()

/**
 * Pasting a spreadsheet range inserts a Markdown table using the first row as header; a hint
 * offers Alt+H to toggle the header off (and back) until the next edit or cursor move.
 */
export function pasteTable(translate: T) {
  const pasted = StateField.define<Pasted | null>({
    create: () => null,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(setPasted)) return e.value
      return tr.docChanged || tr.selection ? null : value
    },
    provide: (f) =>
      showTooltip.compute([f], (state) => {
        const p = state.field(f)
        if (!p) return null
        return {
          pos: p.from,
          above: true,
          create: () => {
            const dom = document.createElement('div')
            dom.className = 'cm-task-hint'
            dom.textContent = translate(p.header ? 'paste.noHeader' : 'paste.withHeader', { key: KEY })
            return { dom }
          },
        }
      }),
  })

  const onPaste = EditorView.domEventHandlers({
    paste(event, view) {
      const data = event.clipboardData
      const text = data?.getData('text/plain') ?? ''
      if (!text.includes('\t')) return false
      const rows = parseTsv(text)
      const cols = Math.max(0, ...rows.map((r) => r.length))
      // Spreadsheets also put an HTML <table> on the clipboard; without it, require a clean grid.
      const fromSheet = /<table[\s>]/i.test(data?.getData('text/html') ?? '') || (rows.length > 1 && rows.every((r) => r.length === cols))
      if (!rows.length || cols < 2 || !fromSheet) return false
      const { state } = view
      const { from, to } = state.selection.main
      for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(from, -1); n; n = n.parent)
        if (n.name === 'FencedCode' || n.name === 'CodeBlock') return false

      // A table needs its own lines, with a blank line before and after.
      const line = state.doc.lineAt(from)
      const endLine = state.doc.lineAt(to)
      const before = state.sliceDoc(line.from, from)
      const after = state.sliceDoc(to, endLine.to)
      const prev = line.number > 1 ? state.doc.line(line.number - 1).text : ''
      const prefix = before.trim() ? '\n\n' : prev.trim() ? '\n' : ''
      const table = toMarkdown(rows, true)
      const start = from + prefix.length
      view.dispatch({
        changes: { from, to, insert: prefix + table + '\n' + (after.trim() ? '\n' : '') },
        selection: { anchor: start + table.length + 1 },
        effects: setPasted.of({ from: start, to: start + table.length, rows, header: true }),
        userEvent: 'input.paste',
        scrollIntoView: true,
      })
      event.preventDefault()
      return true
    },
  })

  const toggleHeader = Prec.high(
    keymap.of([
      {
        key: 'Alt-h',
        run: (view) => {
          const p = view.state.field(pasted)
          if (!p) return false
          const table = toMarkdown(p.rows, !p.header)
          const head = view.state.selection.main.head + table.length - (p.to - p.from)
          view.dispatch({
            changes: { from: p.from, to: p.to, insert: table },
            selection: { anchor: head },
            effects: setPasted.of({ ...p, to: p.from + table.length, header: !p.header }),
          })
          return true
        },
      },
    ]),
  )

  return [pasted, onPaste, toggleHeader]
}
