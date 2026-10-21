import { Prec, StateField } from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import type { T } from '../i18n'
import { toggleTaskAt } from './comments'

const TASK = /^(\s*(?:[-*+]|\d+[.)]) \[)([ xX])\]/
const EMPTY_TASK = /^\s*(?:[-*+]|\d+[.)]) \[ \] $/
const KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘+Enter' : 'Ctrl+Enter'

/** Toggle the checkbox of the task on the cursor line. */
function toggleTask(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const m = TASK.exec(line.text)
  if (!m) return false
  return toggleTaskAt(view, line.from + m[1].length - 1)
}

/**
 * After Enter continues a checklist, hint that the new task can be checked with
 * Mod-Enter. The hint disappears on the next edit or cursor move.
 */
export function taskHint(translate: T) {
  const hint = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, tr) {
      if (!tr.docChanged && !tr.selection) return value
      const head = tr.state.selection.main.head
      const line = tr.state.doc.lineAt(head)
      let newline = false
      tr.changes.iterChanges((_fa, _ta, _fb, _tb, text) => (newline ||= text.lines > 1))
      if (!newline || !tr.isUserEvent('input') || head !== line.to || !EMPTY_TASK.test(line.text)) return null
      return {
        pos: head,
        above: false,
        create: () => {
          const dom = document.createElement('div')
          dom.className = 'cm-task-hint'
          dom.textContent = translate('task.checkHint', { key: KEY })
          return { dom }
        },
      }
    },
    provide: (f) => showTooltip.from(f),
  })
  return [hint, Prec.high(keymap.of([{ key: 'Mod-Enter', run: toggleTask }]))]
}
