import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

export type Align = '' | 'left' | 'center' | 'right'

export interface TableModel {
  header: string[]
  align: Align[]
  rows: string[][]
}

/** Split a table row on unescaped pipes, dropping the outer ones. */
export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

export function parseTable(text: string): TableModel {
  const lines = text.split('\n').filter((l) => l.trim())
  const header = splitRow(lines[0] ?? '')
  const align = splitRow(lines[1] ?? '').map((c): Align => {
    const l = c.startsWith(':')
    const r = c.endsWith(':')
    return l && r ? 'center' : r ? 'right' : l ? 'left' : ''
  })
  const rows = lines.slice(2).map(splitRow)
  const cols = Math.max(header.length, ...rows.map((r) => r.length))
  const pad = (r: string[]) => [...r, ...Array(cols - r.length).fill('')].slice(0, cols)
  return { header: pad(header), align: pad(align) as Align[], rows: rows.map(pad) }
}

export function serializeTable({ header, align, rows }: TableModel): string {
  const esc = (c: string) => c.replace(/\n/g, ' ').replace(/(?<!\\)\|/g, '\\|')
  const all = [header, ...rows].map((r) => r.map(esc))
  const widths = header.map((_, i) => Math.max(3, ...all.map((r) => [...(r[i] ?? '')].length)))
  const line = (r: string[]) => '| ' + r.map((c, i) => c + ' '.repeat(widths[i] - [...c].length)).join(' | ') + ' |'
  const sep =
    '| ' +
    widths
      .map((w, i) => {
        const a = align[i] ?? ''
        const dashes = '-'.repeat(Math.max(1, w - (a === 'center' ? 2 : a ? 1 : 0)))
        return a === 'center' ? `:${dashes}:` : a === 'right' ? `${dashes}:` : a === 'left' ? `:${dashes}` : dashes
      })
      .join(' | ') +
    ' |'
  return [line(all[0]), sep, ...all.slice(1).map(line)].join('\n')
}

/** Range of the GFM table node that contains `pos`, if any. */
export function tableRangeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  for (const side of [1, -1] as const) {
    let node: ReturnType<ReturnType<typeof syntaxTree>['resolve']> | null = syntaxTree(state).resolve(pos, side)
    while (node && node.name !== 'Table') node = node.parent
    if (node) return { from: node.from, to: node.to }
  }
  return null
}
