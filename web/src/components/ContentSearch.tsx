import { CaseSensitive, ChevronDown, ChevronRight, Ellipsis, Regex, RemoveFormatting, Replace, ReplaceAll, WholeWord } from 'lucide-react'
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Reveal, type SearchMatch, type SearchQuery, type SearchResult } from '../api'
import type { T, TKey } from '../i18n'
import { MarkodeIcon } from './MarkodeIcon'

interface Props {
  query: string
  onQuery: (q: string) => void
  input: RefObject<HTMLInputElement | null>
  onClose: () => void
  /** The mode switch (names / content), shown above the inputs. */
  modes: ReactNode
  selected: string | null
  showIgnored: boolean
  lang: string
  /** Bumped when files change on disk: the results are searched again. */
  tick: number
  t: T
  onOpen: (path: string, at: Reveal) => void
  /** Saves the open document's pending edits, so a replace can't be overwritten by them. */
  onBeforeReplace: () => Promise<void>
}

type Toggles = Pick<SearchQuery, 'case' | 'word' | 'regex' | 'rendered'>

const OPTIONS_KEY = 'markode.searchOptions'
const DEFAULT_TOGGLES: Toggles = { case: false, word: false, regex: false, rendered: true }

function loadToggles(): Toggles {
  try {
    return { ...DEFAULT_TOGGLES, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') }
  } catch {
    return DEFAULT_TOGGLES
  }
}

const matchKey = (m: SearchMatch) => `${m.line}:${m.col}`

/** The replacement shown in a match's preview; for a regex, its groups expanded as the server will. */
function replacementFor(text: string, q: SearchQuery, replacement: string) {
  if (!q.regex) return replacement
  try {
    return text.replace(new RegExp(q.q, q.case ? '' : 'i'), replacement)
  } catch {
    return replacement
  }
}

/** VS Code's "Search" view in the sidebar: find text inside every doc, and replace it. */
export function ContentSearch(props: Props) {
  const { query, t } = props
  const [toggles, setToggles] = useState<Toggles>(loadToggles)
  const [replacing, setReplacing] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [details, setDetails] = useState(false)
  const [include, setInclude] = useState('')
  const [exclude, setExclude] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rerun, setRerun] = useState(0)

  const search: SearchQuery = useMemo(() => ({ q: query, ...toggles, include, exclude, ignored: props.showIgnored }), [query, toggles, include, exclude, props.showIgnored])

  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(toggles))
    } catch {}
  }, [toggles])

  useEffect(() => {
    if (!query) {
      setResult(null)
      setError(null)
      return
    }
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      api
        .search(search, props.lang, abort.signal)
        .then((r) => {
          setResult(r)
          setError(null)
        })
        .catch((e) => {
          if (abort.signal.aborted) return
          setResult(null)
          setError(e.message)
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      abort.abort()
    }
  }, [search, props.lang, props.tick, rerun])

  const toggle = (key: keyof Toggles, icon: ReactNode, title: TKey) => (
    <button
      className={`cm-find-toggle${toggles[key] ? ' on' : ''}`}
      title={t(title)}
      aria-pressed={toggles[key]}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setToggles((s) => ({ ...s, [key]: !s[key] }))}
    >
      {icon}
    </button>
  )

  const replace = async (path?: string, only?: string[]) => {
    if (busy) return
    if (!path) {
      if (!result) return
      const n = result.files.reduce((sum, f) => sum + f.matches.filter((m) => m.replaceable).length, 0)
      if (!n || !confirm(t('search.replaceAllConfirm', { n, files: result.files.length, text: replacement }))) return
    }
    setBusy(true)
    try {
      await props.onBeforeReplace()
      await api.replace(search, props.lang, replacement, path, only)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
      setRerun((n) => n + 1)
    }
  }

  const files = result?.files ?? []
  const allCollapsed = files.length > 0 && files.every((f) => collapsed.has(f.path))
  const show = replacing && !!query

  return (
    <>
      {props.modes}
      <div className="content-search">
        <button className={`cm-find-expand${replacing ? ' open' : ''}`} title={t('search.toggleReplaceFiles')} aria-expanded={replacing} onClick={() => setReplacing((r) => !r)}>
          <ChevronRight size={14} />
        </button>
        <div className="content-search-rows">
          <div className={`cm-find-box${error ? ' invalid' : ''}`} title={error ?? undefined}>
            <input
              ref={props.input}
              autoFocus
              className="cm-find-input"
              spellCheck={false}
              value={query}
              placeholder={t('search.contentPlaceholder')}
              onChange={(e) => props.onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') props.onClose()
                if (e.key === 'Enter') setRerun((n) => n + 1)
              }}
            />
            {toggle('case', <CaseSensitive size={15} />, 'search.matchCase')}
            {toggle('word', <WholeWord size={15} />, 'search.wholeWord')}
            {toggle('regex', <Regex size={15} />, 'search.regexp')}
            {toggle('rendered', <RemoveFormatting size={15} />, 'search.rendered')}
          </div>
          {replacing && (
            <div className="content-search-replace">
              <div className="cm-find-box">
                <input
                  className="cm-find-input"
                  spellCheck={false}
                  value={replacement}
                  placeholder={t('search.replace')}
                  onChange={(e) => setReplacement(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') props.onClose()
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.altKey) replace()
                  }}
                />
              </div>
              <button className="cm-find-btn" title={t('search.replaceAllFiles')} disabled={!files.length || busy} onClick={() => replace()}>
                <ReplaceAll size={15} />
              </button>
            </div>
          )}
          <div className="content-search-more">
            <button className={`cm-find-btn${details ? ' on' : ''}`} title={t('search.details')} aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              <Ellipsis size={15} />
            </button>
          </div>
          {details && (
            <>
              <div className="cm-find-box">
                <input className="cm-find-input" spellCheck={false} value={include} placeholder={t('search.include')} title={t('search.globHint')} onChange={(e) => setInclude(e.target.value)} />
              </div>
              <div className="cm-find-box">
                <input className="cm-find-input" spellCheck={false} value={exclude} placeholder={t('search.exclude')} title={t('search.globHint')} onChange={(e) => setExclude(e.target.value)} />
              </div>
            </>
          )}
        </div>
      </div>

      {query && result && (
        <div className="content-search-summary">
          <span style={{ flex: 1 }}>{result.total ? t('search.summary', { n: result.total, files: files.length }) : t('search.none')}</span>
          {files.length > 0 && (
            <button className="icon-btn" title={allCollapsed ? t('app.expandAll') : t('app.collapseAll')} onClick={() => setCollapsed(new Set(allCollapsed ? [] : files.map((f) => f.path)))}>
              {allCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      )}
      {result?.truncated && <div className="sidebar-empty">{t('search.truncated', { n: result.total })}</div>}

      <ul className="tree search-results">
        {files.map((f) => {
          const open = !collapsed.has(f.path)
          const slash = f.path.lastIndexOf('/')
          return (
            <li key={f.path}>
              <div
                className={`node${props.selected === f.path ? ' current' : ''}`}
                title={f.path}
                onClick={() =>
                  setCollapsed((s) => {
                    const n = new Set(s)
                    n.has(f.path) ? n.delete(f.path) : n.add(f.path)
                    return n
                  })
                }
              >
                <span className="chev">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                <span className="ico">
                  <MarkodeIcon size={15} />
                </span>
                <span className="name">
                  {f.path.slice(slash + 1)} {slash > 0 && <span className="dir">{f.path.slice(0, slash)}</span>}
                </span>
                {show && (
                  <button
                    className="icon-btn row-action"
                    title={t('search.replaceInFile')}
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation()
                      replace(f.path)
                    }}
                  >
                    <ReplaceAll size={13} />
                  </button>
                )}
                <span className="count">{f.matches.length}</span>
              </div>
              {open && (
                <ul>
                  {f.matches.map((m) => {
                    const key = `${f.path}|${matchKey(m)}`
                    const text = m.preview.slice(m.start, m.end)
                    return (
                      <li key={key}>
                        <div
                          className={`node match${active === key ? ' selected' : ''}`}
                          title={t('search.line', { n: m.line })}
                          onClick={() => {
                            setActive(key)
                            props.onOpen(f.path, { line: m.line, col: m.col, len: m.len })
                          }}
                        >
                          <span className="preview">
                            {m.preview.slice(0, m.start)}
                            <mark className={show ? 'removed' : undefined}>{text}</mark>
                            {show && <mark className="added">{replacementFor(text, search, replacement)}</mark>}
                            {m.preview.slice(m.end)}
                          </span>
                          {show && (
                            <button
                              className="icon-btn row-action"
                              title={m.replaceable ? t('search.replaceMatch') : t('search.notReplaceable')}
                              disabled={busy || !m.replaceable}
                              onClick={(e) => {
                                e.stopPropagation()
                                replace(f.path, [matchKey(m)])
                              }}
                            >
                              <Replace size={13} />
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {!query && <div className="sidebar-empty">{t('search.contentHint')}</div>}
    </>
  )
}
