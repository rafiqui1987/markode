import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, SearchQuery, search, searchKeymap, setSearchQuery } from '@codemirror/search'
import type { EditorState, Extension } from '@codemirror/state'
import { type Command, EditorView, keymap, type Panel, type ViewUpdate } from '@codemirror/view'
import { ArrowDown, ArrowUp, CaseSensitive, ChevronRight, createElement, type IconNode, Regex, Replace, ReplaceAll, WholeWord, X } from 'lucide'
import type { TKey } from '../i18n'
import { translator } from './livePreview'

/** Matches counted at most; past it the counter shows "N+". */
const MAX_COUNT = 9999

/** Views whose panel should open with the replace row (Ctrl+H). */
const wantReplace = new WeakSet<EditorView>()

/** How many matches the query has, and which one is selected (0 when none is). */
function countMatches(state: EditorState, query: SearchQuery): { total: number; current: number } {
  if (!query.valid) return { total: 0, current: 0 }
  const { from, to } = state.selection.main
  let total = 0
  let current = 0
  const cursor = query.getCursor(state)
  for (let m = cursor.next(); !m.done; m = cursor.next()) {
    total++
    if (m.value.from === from && m.value.to === to) current = total
    if (total > MAX_COUNT) break
  }
  return { total, current }
}

const icon = (node: IconNode) => createElement(node, { width: 15, height: 15, 'stroke-width': 2 })

/** A find/replace box floating at the top right of the editor, like VS Code's. */
function createPanel(view: EditorView): Panel {
  const t = (key: TKey, vars?: Record<string, string | number>) => view.state.facet(translator)(key, vars)
  let query = getSearchQuery(view.state)

  const dom = document.createElement('div')
  dom.className = 'cm-find'

  const button = (node: IconNode, title: TKey, run: () => void, cls = 'cm-find-btn') => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = cls
    b.title = t(title)
    b.setAttribute('aria-label', t(title))
    b.append(icon(node))
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', run)
    return b
  }

  const field = (placeholder: TKey, value: string, main: boolean) => {
    const input = document.createElement('input')
    input.className = 'cm-find-input'
    input.placeholder = t(placeholder)
    input.setAttribute('aria-label', t(placeholder))
    input.value = value
    input.spellcheck = false
    if (main) input.setAttribute('main-field', 'true')
    input.addEventListener('input', commit)
    return input
  }

  const findInput = field('search.find', query.search, true)
  const replaceInput = field('search.replace', query.replace, false)

  const toggle = (node: IconNode, title: TKey, key: 'caseSensitive' | 'wholeWord' | 'regexp') => {
    const b = button(node, title, () => {
      b.classList.toggle('on')
      b.setAttribute('aria-pressed', String(b.classList.contains('on')))
      commit()
    }, 'cm-find-toggle')
    if (query[key]) b.classList.add('on')
    b.setAttribute('aria-pressed', String(query[key]))
    return b
  }
  const caseBtn = toggle(CaseSensitive, 'search.matchCase', 'caseSensitive')
  const wordBtn = toggle(WholeWord, 'search.wholeWord', 'wholeWord')
  const regexBtn = toggle(Regex, 'search.regexp', 'regexp')

  const count = document.createElement('span')
  count.className = 'cm-find-count'

  const run = (cmd: Command) => () => {
    cmd(view)
  }
  const expand = button(ChevronRight, 'search.toggleReplace', () => showReplace(!dom.classList.contains('replacing')), 'cm-find-expand')

  const findBox = document.createElement('div')
  findBox.className = 'cm-find-box'
  findBox.append(findInput, caseBtn, wordBtn, regexBtn)
  const findRow = document.createElement('div')
  findRow.className = 'cm-find-row'
  findRow.append(findBox, count, button(ArrowUp, 'search.previous', run(findPrevious)), button(ArrowDown, 'search.next', run(findNext)), button(X, 'search.close', run(closeSearchPanel)))

  const replaceBox = document.createElement('div')
  replaceBox.className = 'cm-find-box'
  replaceBox.append(replaceInput)
  const replaceRow = document.createElement('div')
  replaceRow.className = 'cm-find-row cm-replace-row'
  replaceRow.append(replaceBox, button(Replace, 'search.replaceOne', run(replaceNext)), button(ReplaceAll, 'search.replaceAll', run(replaceAll)))

  const rows = document.createElement('div')
  rows.className = 'cm-find-rows'
  rows.append(findRow, replaceRow)
  dom.append(expand, rows)

  function showReplace(on: boolean) {
    dom.classList.toggle('replacing', on)
    expand.setAttribute('aria-expanded', String(on))
    if (on) replaceInput.focus()
  }

  function commit() {
    const next = new SearchQuery({
      search: findInput.value,
      replace: replaceInput.value,
      caseSensitive: caseBtn.classList.contains('on'),
      wholeWord: wordBtn.classList.contains('on'),
      regexp: regexBtn.classList.contains('on'),
    })
    if (next.eq(query)) return
    query = next
    view.dispatch({ effects: setSearchQuery.of(next) })
  }

  function refresh() {
    const invalid = !!query.search && !query.valid
    findBox.classList.toggle('invalid', invalid)
    if (!query.search || invalid) {
      count.textContent = ''
      count.classList.remove('none')
      return
    }
    const { total, current } = countMatches(view.state, query)
    const shown = total > MAX_COUNT ? `${MAX_COUNT}+` : String(total)
    count.textContent = total ? t('search.count', { n: current || '?', total: shown }) : t('search.none')
    count.classList.toggle('none', !total)
  }

  dom.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSearchPanel(view)
      view.focus()
    } else if (e.key === 'Enter' && e.target === findInput) {
      e.preventDefault()
      ;(e.shiftKey ? findPrevious : findNext)(view)
    } else if (e.key === 'Enter' && e.target === replaceInput) {
      e.preventDefault()
      ;(mod && e.altKey ? replaceAll : replaceNext)(view)
    } else if (e.altKey && !mod && /^Key[CWR]$/.test(e.code)) {
      // Alt+C / Alt+W / Alt+R toggle the options, as in VS Code.
      e.preventDefault()
      ;({ KeyC: caseBtn, KeyW: wordBtn, KeyR: regexBtn } as Record<string, HTMLButtonElement>)[e.code].click()
    } else if (mod && e.key.toLowerCase() === 'h') {
      e.preventDefault()
      showReplace(!dom.classList.contains('replacing'))
    }
  })

  if (wantReplace.has(view)) {
    wantReplace.delete(view)
    dom.classList.add('replacing')
  }
  expand.setAttribute('aria-expanded', String(dom.classList.contains('replacing')))

  return {
    dom,
    top: true,
    mount() {
      // Opened with Ctrl+H the replace row is shown, but the search text still comes first.
      findInput.select()
      refresh()
    },
    update(u: ViewUpdate) {
      for (const tr of u.transactions)
        for (const e of tr.effects) {
          // The query was changed elsewhere (e.g. Ctrl+F with text selected): show it.
          if (e.is(setSearchQuery) && !e.value.eq(query)) {
            query = e.value
            findInput.value = query.search
            replaceInput.value = query.replace
            caseBtn.classList.toggle('on', query.caseSensitive)
            wordBtn.classList.toggle('on', query.wholeWord)
            regexBtn.classList.toggle('on', query.regexp)
          }
        }
      if (wantReplace.has(view)) {
        wantReplace.delete(view)
        showReplace(true)
      }
      if (u.docChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))) refresh()
    },
  }
}

/** Ctrl+H: open the panel with the replace row. */
const openReplace: Command = (view) => {
  wantReplace.add(view)
  openSearchPanel(view)
  // Already open: the panel's update shows the row on the next transaction.
  view.dispatch({})
  return true
}

export function searchPanel(): Extension {
  return [search({ top: true, createPanel }), keymap.of([{ key: 'Mod-h', run: openReplace, preventDefault: true }, ...searchKeymap])]
}
