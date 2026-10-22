import { Check, ChevronRight, Copy, FileText, GitCompare, LayoutDashboard, Moon, PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, ScrollText, Settings as SettingsIcon, Sparkles, Sun, Undo2 } from 'lucide-react'
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, type EditorSettings, type ProposalLayout, type FileData, type Info, type Lang, LANG_NAMES, type SyncStatus, subscribe, type TreeData, type TreeNode } from './api'
import { type EditHistory, Editor, type EditorCommands, NO_HISTORY } from './components/Editor'
import { Changes, Dashboard, ProposalBanner, Rules, StatusChip } from './components/Pages'
import { applySettings, DEFAULT_SETTINGS, Settings, type SettingsSection, type Theme } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { Skills } from './components/Skills'
import { makeT } from './i18n'

type View = 'editor' | 'dashboard' | 'changes' | 'rules' | 'skills'

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {}
  },
}

function useResolvedTheme(theme: Theme): 'light' | 'dark' {
  const [system, setSystem] = useState<'light' | 'dark'>(() => (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: light)')
    const on = () => setSystem(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const resolved = theme ?? system
  // Layout effect: it must run before the editor's effects, which read it to theme diagrams.
  useLayoutEffect(() => {
    document.documentElement.dataset.resolvedTheme = resolved
  }, [resolved])
  return resolved
}

const SIDEBAR_DEFAULT = 260
const SIDEBAR_MIN = 180
const sidebarMax = () => Math.max(SIDEBAR_MIN, Math.min(640, window.innerWidth * 0.6))

/** A simple frontmatter field (`status`, `type`…) of a doc's content. */
const fieldOf = (content: string, key: string) => {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? ''
  return new RegExp(`^${key}:\\s*([\\w-]+)`, 'm').exec(fm)?.[1] ?? null
}
const statusOf = (content: string) => fieldOf(content, 'status')
/** A proposal's `affects: [a, b]` (inline list): the docs its decision will change. */
const affectsOf = (content: string) => {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? ''
  const list = /^affects:\s*\[(.*)\]/m.exec(fm)?.[1] ?? ''
  return list
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function App() {
  const [info, setInfo] = useState<Info | null>(null)
  const [data, setData] = useState<TreeData>({ tree: [], git: {}, sync: {}, foreign: {} })
  const [selected, setSelected] = useState<string | null>(() => decodeURIComponent(location.hash.slice(2)) || null)
  const [view, setView] = useState<View>(() => (store.get('markode.view') as View) || 'editor')
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = store.get('markode.theme')
    return stored === 'light' || stored === 'dark' ? stored : null
  })
  const [showIgnored, setShowIgnored] = useState(false)
  const [file, setFile] = useState<FileData | null>(null)
  const [saving, setSaving] = useState(false)
  const [tick, setTick] = useState(0)
  const [fileTick, setFileTick] = useState(0)
  // The UI language is cached locally too, so the menus don't flash in English while settings load.
  const [settings, setSettings] = useState<EditorSettings>(() => ({ ...DEFAULT_SETTINGS, uiLang: store.get('markode.uiLang') || DEFAULT_SETTINGS.uiLang }))
  const [settingsOpen, setSettingsOpen] = useState<SettingsSection | null>(null)
  /** Set once the user sends their answer to a proposal, until another file opens. */
  const [answered, setAnswered] = useState<string | null>(null)
  /** The agent was waiting on that proposal (`markode wait`), so nothing had to be copied. */
  const [listening, setListening] = useState(false)
  const [pendingTranslations, setPendingTranslations] = useState(0)
  const [copiedTranslate, setCopiedTranslate] = useState(false)
  const [editHistory, setEditHistory] = useState<EditHistory>(NO_HISTORY)
  const editorCommands = useRef<EditorCommands | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(store.get('markode.sidebarWidth')) || SIDEBAR_DEFAULT)
  const [sidebarHidden, setSidebarHidden] = useState(() => store.get('markode.sidebarHidden') === '1')
  const [storedLang, setStoredLang] = useState<string | null>(() => store.get('markode.viewLang'))
  const resolvedTheme = useResolvedTheme(theme)

  // The language the docs are viewed in: the source one, or an enabled translation.
  const sourceLang = info?.sourceLang ?? 'en'
  const viewLang: string = storedLang && info?.langs.includes(storedLang) ? storedLang : sourceLang
  const nameOf = (code: string) => info?.langNames[code] ?? LANG_NAMES[code as Lang] ?? code
  // The menus' language is a setting of its own, independent of the docs' one.
  const t = useMemo(() => makeT(settings.uiLang), [settings.uiLang])
  const viewLangRef = useRef(viewLang)
  viewLangRef.current = viewLang
  const refreshTree = useCallback(() => api.tree(viewLangRef.current).then(setData), [])
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  useEffect(() => {
    api.info().then((i) => {
      setInfo(i)
      if (!selectedRef.current && i.mainDoc) setSelected(i.mainDoc)
    })
    api.settings().then((s) => setSettings(s))
  }, [])
  useEffect(() => {
    if (info) refreshTree()
  }, [info, viewLang])
  useEffect(() => {
    if (info?.langs.length) api.translations().then((r) => setPendingTranslations(r.pending)).catch(() => {})
    else setPendingTranslations(0)
  }, [info, tick])
  useEffect(() => applySettings(settings), [settings])
  useEffect(() => store.set('markode.uiLang', settings.uiLang), [settings.uiLang])
  useEffect(() => {
    document.documentElement.lang = viewLang
  }, [viewLang])

  // Persist editor settings shortly after the last change (sliders fire continuously).
  const saveTimer = useRef<number | undefined>(undefined)
  const changeSettings = (s: EditorSettings) => {
    setSettings(s)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => api.saveSettings(s), 300)
  }

  useEffect(() => {
    let timer: number | undefined
    const refreshAll = () => {
      refreshTree()
      setTick((n) => n + 1)
    }
    const unsubscribe = subscribe((e) => {
      // Sync state (state.json) changes the open file's status without touching its content.
      if (e.path === selectedRef.current || e.path.startsWith('.markode/')) setFileTick((n) => n + 1)
      if (e.path === '.markode/config.json') api.info().then(setInfo)
      window.clearTimeout(timer)
      timer = window.setTimeout(refreshAll, 250)
    })
    // Fallback for changes the watcher missed (e.g. while the tab was in the background).
    const onFocus = () => {
      setFileTick((n) => n + 1)
      refreshAll()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    if (selected) history.replaceState(null, '', `#/${encodeURI(selected)}`)
  }, [selected])
  useEffect(() => store.set('markode.view', view), [view])
  useEffect(() => store.set('markode.theme', theme ?? ''), [theme])
  useEffect(() => store.set('markode.sidebarWidth', String(sidebarWidth)), [sidebarWidth])
  useEffect(() => store.set('markode.sidebarHidden', sidebarHidden ? '1' : '0'), [sidebarHidden])

  // Drag the sidebar's edge to resize it; dragging it almost shut hides it.
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    document.body.classList.add('resizing')
    const startWidth = sidebarWidth
    const move = (ev: PointerEvent) => {
      // Hidden this way, it comes back at the width it had before the drag.
      if (ev.clientX < SIDEBAR_MIN / 2) return setSidebarHidden(true), setSidebarWidth(startWidth)
      setSidebarHidden(false)
      setSidebarWidth(Math.round(Math.min(sidebarMax(), Math.max(SIDEBAR_MIN, ev.clientX))))
    }
    const up = () => {
      document.body.classList.remove('resizing')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  const open = (path: string) => {
    setSelected(path)
    setView('editor')
  }

  const setLang = (lang: string) => {
    setStoredLang(lang)
    store.set('markode.viewLang', lang)
  }

  const changeProposals = async (active: boolean, layout: ProposalLayout) => {
    await api.setProposals(active, layout).catch((e) => alert(e.message))
    setInfo(await api.info())
  }

  // Answering a proposal: mark it answered. An agent waiting on it (`markode wait`) wakes up by itself;
  // otherwise a message for the AI chat is copied.
  const sendAnswer = async () => {
    if (!selected) return
    const path = selected
    const waiting = await api
      .waiting()
      .then((r) => r.paths.includes(path))
      .catch(() => false)
    editorCommands.current?.setField('status', 'answered')
    editorCommands.current?.setField('updated', today())
    if (!waiting) navigator.clipboard?.writeText(t('proposal.message', { path })).catch(() => {})
    setListening(waiting)
    setAnswered(path)
  }

  const copyTranslate = () =>
    navigator.clipboard?.writeText('/markode translate').then(() => {
      setCopiedTranslate(true)
      setTimeout(() => setCopiedTranslate(false), 1500)
    })

  const changeLanguages = async (c: { sourceLang?: Lang; langs?: string[] }) => {
    await api.setConfig(c).catch((e) => alert(e.message))
    setInfo(await api.info())
  }

  const create = async (dir: string, name: string, kind: TreeNode['kind']) => {
    if (kind === 'file' && !name.toLowerCase().endsWith('.md')) name += '.md'
    const rel = dir ? `${dir}/${name}` : name
    const res = await (kind === 'dir' ? api.createDir(rel) : api.create(rel)).catch((e) => void alert(e.message))
    if (!res) return null
    await refreshTree()
    if (kind === 'file') open(res.path)
    return res.path
  }

  const remove = async (node: TreeNode) => {
    const preview = await api.deletePreview(node.path).catch((e) => void alert(e.message))
    if (!preview) return
    const question = preview.kind === 'dir' ? t('app.deleteDirConfirm', { path: node.path, files: preview.files, md: preview.md }) : t('app.deleteFileConfirm', { path: node.path })
    if (!confirm(question)) return
    const inside = (p: string | null) => !!p && (p === node.path || p.startsWith(node.path + '/'))
    // Close it first and let the editor flush pending edits, so they can't recreate it after the delete.
    if (inside(selected)) {
      setSelected(inside(info?.mainDoc ?? null) ? null : (info?.mainDoc ?? null))
      await new Promise((r) => setTimeout(r))
    }
    await api.remove(node.path).catch((e) => alert(e.message))
    refreshTree()
  }

  const status: SyncStatus | null = file?.status ?? null
  const crumbs = selected?.split('/') ?? []
  const commentAs = info?.proposals.active ? (info.author ?? t('comment.me')) : null
  const layoutKey = `${settings.font}|${settings.size}|${settings.lineHeight}|${settings.padding}|${settings.width}`

  const ThemeIcon = resolvedTheme === 'light' ? Sun : Moon
  const tabs: { id: View; icon: typeof FileText; label: string }[] = [
    { id: 'editor', icon: FileText, label: t('view.editor') },
    { id: 'dashboard', icon: LayoutDashboard, label: t('view.dashboard') },
    { id: 'changes', icon: GitCompare, label: t('view.changes') },
    { id: 'rules', icon: ScrollText, label: t('view.rules') },
    { id: 'skills', icon: Sparkles, label: t('view.skills') },
  ]

  return (
    <div className="app" data-sidebar={sidebarHidden ? 'hidden' : undefined} style={{ '--sidebar-w': `${Math.min(sidebarWidth, sidebarMax())}px` } as CSSProperties}>
      <header className="topbar">
        <button className="icon-btn" title={sidebarHidden ? t('app.showSidebar') : t('app.hideSidebar')} onClick={() => setSidebarHidden((h) => !h)}>
          {sidebarHidden ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <div className="brand">
          markode <small>{info?.name}</small>
        </div>
        <nav className="tabs">
          {tabs.map((tab) => (
            <button key={tab.id} className={`tab${view === tab.id ? ' active' : ''}`} onClick={() => setView(tab.id)}>
              <tab.icon size={15} /> {tab.label}
              {tab.id === 'changes' && Object.keys(data.git).length > 0 && <span className="pill">{Object.keys(data.git).length}</span>}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        {pendingTranslations > 0 && (
          <button className="pill warn" title={t('sync.copyCommand')} onClick={copyTranslate}>
            {copiedTranslate ? <Check size={12} /> : <Copy size={12} />} {copiedTranslate ? t('app.copied') : t('sync.pendingCount', { n: pendingTranslations })}
          </button>
        )}
        {info && info.langs.length > 0 && (
          <select className="control" title={t('app.language')} value={viewLang} onChange={(e) => setLang(e.target.value)}>
            <option value={sourceLang}>
              {LANG_NAMES[sourceLang]} ({t('lang.original')})
            </option>
            {info.langs.map((l) => (
              <option key={l} value={l}>
                {nameOf(l)}
              </option>
            ))}
          </select>
        )}
        <button className="icon-btn" title={t('app.settings')} onClick={() => setSettingsOpen('general')}>
          <SettingsIcon size={16} />
        </button>
        <button className="icon-btn" title={t('app.theme')} onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
          <ThemeIcon size={16} />
        </button>
      </header>

      <Sidebar
        tree={data.tree}
        git={data.git}
        sync={data.sync}
        foreign={data.foreign}
        selected={view === 'editor' ? selected : null}
        mainDoc={info?.mainDoc ?? null}
        showIgnored={showIgnored}
        t={t}
        onOpen={open}
        onToggleIgnored={() => setShowIgnored((s) => !s)}
        onIgnore={async (node, ignored) => {
          await api.ignore(node.path, node.kind, ignored)
          refreshTree()
        }}
        onCreate={create}
        onDelete={remove}
      />
      {!sidebarHidden && <div className="sidebar-resizer" title={t('app.resizeSidebar')} onPointerDown={startResize} onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)} />}

      <main className="main">
        {view === 'editor' &&
          (selected ? (
            <>
              <div className="crumbs">
                <div className="edit-actions">
                  {/* preventDefault keeps the focus (and the selection) in the editor. */}
                  <button className="icon-btn" title={t('app.undo')} disabled={!editHistory.undo} onMouseDown={(e) => e.preventDefault()} onClick={() => editorCommands.current?.undo()}>
                    <Undo2 size={15} />
                  </button>
                  <button className="icon-btn" title={t('app.redo')} disabled={!editHistory.redo} onMouseDown={(e) => e.preventDefault()} onClick={() => editorCommands.current?.redo()}>
                    <Redo2 size={15} />
                  </button>
                  <button className="icon-btn" title={t('app.discard')} disabled={!editHistory.dirty} onMouseDown={(e) => e.preventDefault()} onClick={() => editorCommands.current?.discard()}>
                    <RotateCcw size={15} />
                  </button>
                </div>
                {crumbs.map((c, i) => (
                  <span key={i} style={{ display: 'contents' }}>
                    {i > 0 && <ChevronRight size={13} className="sep" />}
                    <span className={i === crumbs.length - 1 ? 'last' : ''}>{c}</span>
                  </span>
                ))}
                {file && <span className="status"><StatusChip status={statusOf(file.content)} t={t} /></span>}
                <span className="save">{saving ? t('app.saving') : file ? t('app.saved') : ''}</span>
              </div>
              {file && fieldOf(file.content, 'type') === 'proposal' && (
                <ProposalBanner status={statusOf(file.content) !== 'applied' && answered === selected ? 'answered' : statusOf(file.content)} copied={answered === selected} listening={answered === selected && listening} affects={affectsOf(file.content)} t={t} onSend={sendAnswer} onOpen={open} />
              )}
              {viewLang !== sourceLang && status && status !== 'synced' && (
                <div className={`banner sync-${status}`}>
                  <span className={`dot sync-${status}`} /> {t(`sync.${status}`)} · {t('sync.hint')}
                </div>
              )}
              {viewLang === sourceLang && data.foreign[selected] && (
                <div className="banner foreign">
                  {t('foreign.banner', { lang: LANG_NAMES[data.foreign[selected]], source: LANG_NAMES[sourceLang] })}
                  <button
                    className="btn"
                    onClick={async () => {
                      await api.keepLanguage(selected)
                      refreshTree()
                    }}
                  >
                    {t('foreign.keep', { lang: LANG_NAMES[data.foreign[selected]] })}
                  </button>
                </div>
              )}
              <Editor
                key={`${selected}|${viewLang}|${commentAs}|${settings.uiLang}`}
                path={selected}
                lang={viewLang}
                layoutKey={layoutKey}
                wrap={settings.wrap}
                theme={resolvedTheme}
                t={t}
                externalTick={fileTick}
                onLoaded={setFile}
                onHistory={setEditHistory}
                commands={editorCommands}
                author={commentAs}
                onSaving={setSaving}
                onSaved={(s) => {
                  setFile((f) => (f ? { ...f, status: s } : f))
                  refreshTree()
                }}
              />
            </>
          ) : (
            <div className="empty">{t('app.noFile')}</div>
          ))}
        {view === 'dashboard' && <Dashboard t={t} tick={tick} onOpen={open} proposalsActive={!!info?.proposals.active} onActivateProposals={() => setSettingsOpen('proposals')} />}
        {view === 'changes' && <Changes t={t} git={data.git} enabled={!!info?.git} tick={tick} />}
        {view === 'rules' && <Rules t={t} />}
        {view === 'skills' && <Skills t={t} tick={tick} look={{ layoutKey, wrap: settings.wrap, theme: resolvedTheme }} />}
      </main>

      {settingsOpen && info && <Settings t={t} section={settingsOpen} pendingTranslations={pendingTranslations} theme={theme} onTheme={setTheme} info={info} settings={settings} onSettings={changeSettings} onLanguages={changeLanguages} onProposals={changeProposals} onClose={() => setSettingsOpen(null)} />}
    </div>
  )
}
