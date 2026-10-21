import { ChevronRight, FileText, GitCompare, LayoutDashboard, Moon, ScrollText, Settings as SettingsIcon, Sun } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, type EditorSettings, type FileData, type Info, type Lang, LANG_NAMES, type SyncStatus, subscribe, type TreeData, type TreeNode } from './api'
import { Editor } from './components/Editor'
import { Changes, Dashboard, Rules, StatusChip } from './components/Pages'
import { applySettings, DEFAULT_SETTINGS, Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { makeT } from './i18n'

type View = 'editor' | 'dashboard' | 'changes' | 'rules'
/** null follows the system until the user picks one with the toggle. */
type Theme = 'light' | 'dark' | null

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

const statusOf = (content: string) => {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? ''
  return /^status:\s*([\w-]+)/m.exec(fm)?.[1] ?? null
}

export function App() {
  const [info, setInfo] = useState<Info | null>(null)
  const [data, setData] = useState<TreeData>({ tree: [], git: {}, sync: {}, foreign: {} })
  const [selected, setSelected] = useState<string | null>(() => decodeURIComponent(location.hash.slice(2)) || null)
  const [view, setView] = useState<View>(() => (store.get('mdrules.view') as View) || 'editor')
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = store.get('mdrules.theme')
    return stored === 'light' || stored === 'dark' ? stored : null
  })
  const [showIgnored, setShowIgnored] = useState(false)
  const [file, setFile] = useState<FileData | null>(null)
  const [saving, setSaving] = useState(false)
  const [tick, setTick] = useState(0)
  const [fileTick, setFileTick] = useState(0)
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editHistory, setEditHistory] = useState({ undo: 0, redo: 0 })
  const editorCommands = useRef<{ undo: () => void; redo: () => void } | null>(null)
  const [storedLang, setStoredLang] = useState<Lang | null>(() => store.get('mdrules.viewLang') as Lang | null)
  const resolvedTheme = useResolvedTheme(theme)

  // The language being viewed: the source one, or an enabled translation. It also drives the UI language.
  const sourceLang = info?.sourceLang ?? 'en'
  const viewLang: Lang = storedLang && info?.langs.includes(storedLang) ? storedLang : sourceLang
  const t = useMemo(() => makeT(viewLang), [viewLang])
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
  useEffect(() => applySettings(settings), [settings])
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
      if (e.path === selectedRef.current || e.path.startsWith('.mdrules/')) setFileTick((n) => n + 1)
      if (e.path === '.mdrules/config.json') api.info().then(setInfo)
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
  useEffect(() => store.set('mdrules.view', view), [view])
  useEffect(() => {
    if (theme) store.set('mdrules.theme', theme)
  }, [theme])

  const open = (path: string) => {
    setSelected(path)
    setView('editor')
  }

  const setLang = (lang: Lang) => {
    setStoredLang(lang)
    store.set('mdrules.viewLang', lang)
  }

  const changeLanguages = async (c: { sourceLang?: Lang; langs?: Lang[] }) => {
    await api.setConfig(c).catch((e) => alert(e.message))
    setInfo(await api.info())
  }

  const create = async (dir: string) => {
    let name = prompt(t('app.newFilePrompt'), 'new-doc.md')?.trim()
    if (!name) return
    if (!name.toLowerCase().endsWith('.md')) name += '.md'
    const res = await api.create(dir ? `${dir}/${name}` : name).catch((e) => alert(e.message))
    if (res) {
      await refreshTree()
      open(res.path)
    }
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

  const pendingCount = Object.values(data.sync).filter((s) => s === 'pending-sync' || s === 'conflict').length
  const status: SyncStatus | null = file?.status ?? null
  const crumbs = selected?.split('/') ?? []

  const ThemeIcon = resolvedTheme === 'light' ? Sun : Moon
  const tabs: { id: View; icon: typeof FileText; label: string }[] = [
    { id: 'editor', icon: FileText, label: t('view.editor') },
    { id: 'dashboard', icon: LayoutDashboard, label: t('view.dashboard') },
    { id: 'changes', icon: GitCompare, label: t('view.changes') },
    { id: 'rules', icon: ScrollText, label: t('view.rules') },
  ]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          mdrules <small>{info?.name}</small>
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
        {pendingCount > 0 && <span className="pill warn">{t('sync.pendingCount', { n: pendingCount })}</span>}
        {info && info.langs.length > 0 && (
          <select className="control" title={t('app.language')} value={viewLang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value={sourceLang}>
              {LANG_NAMES[sourceLang]} ({t('lang.original')})
            </option>
            {info.langs.map((l) => (
              <option key={l} value={l}>
                {LANG_NAMES[l]}
              </option>
            ))}
          </select>
        )}
        <button className="icon-btn" title={t('app.settings')} onClick={() => setSettingsOpen(true)}>
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
        history={view === 'editor' ? editHistory : { undo: 0, redo: 0 }}
        onUndo={() => editorCommands.current?.undo()}
        onRedo={() => editorCommands.current?.redo()}
      />

      <main className="main">
        {view === 'editor' &&
          (selected ? (
            <>
              <div className="crumbs">
                {crumbs.map((c, i) => (
                  <span key={i} style={{ display: 'contents' }}>
                    {i > 0 && <ChevronRight size={13} className="sep" />}
                    <span className={i === crumbs.length - 1 ? 'last' : ''}>{c}</span>
                  </span>
                ))}
                {file && <span className="status"><StatusChip status={statusOf(file.content)} t={t} /></span>}
                <span className="save">{saving ? t('app.saving') : file ? t('app.saved') : ''}</span>
              </div>
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
                key={`${selected}|${viewLang}`}
                path={selected}
                lang={viewLang}
                layoutKey={`${settings.font}|${settings.size}|${settings.lineHeight}|${settings.padding}|${settings.width}`}
                wrap={settings.wrap}
                theme={resolvedTheme}
                t={t}
                externalTick={fileTick}
                onLoaded={setFile}
                onHistory={setEditHistory}
                commands={editorCommands}
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
        {view === 'dashboard' && <Dashboard t={t} tick={tick} onOpen={open} />}
        {view === 'changes' && <Changes t={t} git={data.git} enabled={!!info?.git} tick={tick} />}
        {view === 'rules' && <Rules t={t} />}
      </main>

      {settingsOpen && info && <Settings t={t} info={info} settings={settings} onSettings={changeSettings} onLanguages={changeLanguages} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
