import { syntaxTree } from '@codemirror/language'
import { type EditorState, StateEffect, StateField } from '@codemirror/state'
import { EditorView, hoverTooltip, showTooltip, type Tooltip } from '@codemirror/view'
import { Check, Copy, createElement, type IconNode, Pencil, Unlink } from 'lucide'
import { docPath, openDoc, translator } from './livePreview'

interface LinkAt {
  from: number
  to: number
  /** The visible text, between `[` and `]`. */
  textFrom: number
  textTo: number
  /** The destination; null for reference links (`[text][ref]`), which have none of their own. */
  url: { from: number; to: number; value: string } | null
}

function linkAt(state: EditorState, pos: number): LinkAt | null {
  for (const side of [1, -1] as const) {
    for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, side); node; node = node.parent) {
      if (node.name !== 'Link') continue
      const marks = node.getChildren('LinkMark')
      if (marks.length < 2) return null
      const url = node.getChild('URL')
      return {
        from: node.from,
        to: node.to,
        textFrom: marks[0].to,
        textTo: marks[1].from,
        url: url && { from: url.from, to: url.to, value: state.sliceDoc(url.from, url.to).replace(/^<|>$/g, '') },
      }
    }
  }
  return null
}

/** A link's target as a project path, when it is a relative link (not `https:`, `mailto:`, `#section`). */
function projectPath(url: string, from: string) {
  if (/^[a-z][\w+.-]*:/i.test(url) || url.startsWith('#')) return null
  const parts = url.startsWith('/') ? [] : from.split('/').slice(0, -1)
  for (const seg of decodeURI(url.split('#')[0]).split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

function follow(view: EditorView, url: string) {
  const path = projectPath(url, view.state.facet(docPath))
  if (path === null) return void (url.startsWith('#') || window.open(url, '_blank', 'noopener'))
  const open = view.state.facet(openDoc)
  if (open && /\.md$/i.test(path)) open(path)
}

function iconButton(icon: IconNode, title: string, run: () => void) {
  const b = document.createElement('button')
  b.title = title
  b.append(createElement(icon, { width: 13, height: 13 }))
  b.addEventListener('mousedown', (e) => {
    e.preventDefault()
    run()
  })
  return b
}

// ------------------------------------------------------------ editing a link

const editLink = StateEffect.define<number | null>()

/** The start of the link being edited (its form is open), if any. */
const editing = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(editLink)) return e.value
    // Typing or clicking elsewhere in the document closes the form.
    return tr.docChanged || tr.selection ? null : value
  },
  provide: (f) => showTooltip.compute([f], (state) => (state.field(f) === null ? null : editTooltip(state, state.field(f)!))),
})

function editTooltip(state: EditorState, pos: number): Tooltip | null {
  const link = linkAt(state, pos + 1)
  if (!link) return null
  return {
    pos: link.textFrom,
    above: false,
    create: (view) => {
      const t = view.state.facet(translator)
      const dom = document.createElement('form')
      dom.className = 'cm-link-edit'
      const field = (label: string, value: string) => {
        const wrap = document.createElement('label')
        const input = document.createElement('input')
        input.value = value
        input.spellcheck = false
        wrap.append(label, input)
        dom.append(wrap)
        return input
      }
      const text = field(t('link.text'), view.state.sliceDoc(link.textFrom, link.textTo))
      const url = field(t('link.url'), link.url?.value ?? '')
      const close = () => {
        view.dispatch({ effects: editLink.of(null) })
        view.focus()
      }
      const save = () => {
        const current = linkAt(view.state, pos + 1)
        if (!current) return close()
        const dest = /\s/.test(url.value.trim()) ? `<${url.value.trim()}>` : url.value.trim()
        // The title (`"…"` after the URL), if any, is kept.
        const changes = [{ from: current.textFrom, to: current.textTo, insert: text.value }]
        if (current.url) changes.push({ from: current.url.from, to: current.url.to, insert: dest })
        view.dispatch({ changes, effects: editLink.of(null), selection: { anchor: current.textFrom + text.value.length } })
        view.focus()
      }
      const unlink = () => {
        const current = linkAt(view.state, pos + 1)
        if (current) view.dispatch({ changes: { from: current.from, to: current.to, insert: view.state.sliceDoc(current.textFrom, current.textTo) }, effects: editLink.of(null) })
        view.focus()
      }
      const actions = document.createElement('div')
      actions.className = 'cm-link-actions'
      actions.append(iconButton(Unlink, t('link.remove'), unlink), iconButton(Check, t('link.save'), save))
      dom.append(actions)
      dom.addEventListener('submit', (e) => {
        e.preventDefault()
        save()
      })
      dom.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          close()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          save()
        }
      })
      return {
        dom,
        mount: () => {
          text.focus()
          text.select()
        },
      }
    },
  }
}

// ------------------------------------------------------------ hover and click

/** Hovering a link shows where it goes, with subtle buttons to edit it or copy it. */
const linkHover = hoverTooltip(
  (view, pos) => {
    const link = linkAt(view.state, pos)
    if (!link || pos < link.textFrom || pos > link.textTo || view.state.field(editing) !== null) return null
    return {
      pos: link.textFrom,
      end: link.textTo,
      above: true,
      create: () => {
        const t = view.state.facet(translator)
        const dom = document.createElement('div')
        dom.className = 'cm-link-hover'
        if (link.url) {
          const target = document.createElement('span')
          target.className = 'cm-link-url'
          target.textContent = link.url.value
          target.title = link.url.value
          dom.append(target)
        }
        dom.append(
          iconButton(Pencil, t('link.edit'), () => view.dispatch({ effects: editLink.of(link.from) })),
        )
        if (link.url) {
          const copy = iconButton(Copy, t('link.copy'), () => {
            navigator.clipboard?.writeText(link.url!.value).then(() => copy.replaceChildren(createElement(Check, { width: 13, height: 13 })))
          })
          dom.append(copy)
        }
        return { dom }
      },
    }
  },
  { hoverTime: 350 },
)

/** A click on a link (not a drag that selects) follows it. */
const linkClick = EditorView.domEventHandlers({
  click(event, view) {
    if (event.button !== 0 || event.shiftKey || event.altKey || !view.state.selection.main.empty) return false
    const el = (event.target as HTMLElement).closest('.cm-link-text')
    if (!el || !view.contentDOM.contains(el)) return false
    const link = linkAt(view.state, view.posAtDOM(el))
    if (!link?.url) return false
    follow(view, link.url.value)
    return true
  },
})

export const linkActions = [editing, linkHover, linkClick]
