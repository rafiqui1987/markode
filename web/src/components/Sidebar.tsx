import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Eye, EyeOff, FilePlus, FileText, Folder, FolderOpen, Package, Redo2, Search, Trash2, Undo2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type GitStatus, type Lang, LANG_NAMES, type SyncStatus, type TreeNode } from '../api'
import type { T } from '../i18n'

interface Props {
  tree: TreeNode[]
  git: Record<string, GitStatus>
  sync: Record<string, SyncStatus>
  foreign: Record<string, Lang>
  selected: string | null
  mainDoc: string | null
  showIgnored: boolean
  t: T
  onOpen: (path: string) => void
  onToggleIgnored: () => void
  onIgnore: (node: TreeNode, ignored: boolean) => void
  onCreate: (dir: string) => void
  onDelete: (node: TreeNode) => void
  /** Undo/redo steps of the open file; the buttons only show once there is something to undo. */
  history: { undo: number; redo: number }
  onUndo: () => void
  onRedo: () => void
}

const EXPANDED_KEY = 'mdrules.expanded'

function loadExpanded(): Set<string> | null {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    return raw ? new Set(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

const dirPaths = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => (n.kind === 'dir' ? [n.path, ...dirPaths(n.children ?? [])] : []))

/** Nodes whose path matches `query`, plus the folders that contain them. */
function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  return nodes.flatMap((n) => {
    if (n.kind === 'file') return n.path.toLowerCase().includes(query) ? [n] : []
    const children = filterTree(n.children ?? [], query)
    return children.length || n.name.toLowerCase().includes(query) ? [{ ...n, children: children.length ? children : n.children }] : []
  })
}

/** A folder shows a git badge when anything inside it changed. */
function dirHasChanges(node: TreeNode, git: Record<string, GitStatus>): boolean {
  return Object.keys(git).some((p) => p.startsWith(node.path + '/'))
}

export function Sidebar(props: Props) {
  const { tree, selected, showIgnored, t } = props
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded() ?? new Set(tree.filter((n) => n.kind === 'dir').map((n) => n.path)))
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const q = query.trim().toLowerCase()
  const visible = useMemo(() => (q ? filterTree(tree, q) : tree), [tree, q])
  const anyExpanded = expanded.size > 0

  const closeSearch = () => {
    setSearching(false)
    setQuery('')
  }

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
    } catch {}
  }, [expanded])

  // Reveal the selected file.
  useEffect(() => {
    if (!selected) return
    const parts = selected.split('/').slice(0, -1)
    const ancestors = parts.map((_, i) => parts.slice(0, i + 1).join('/'))
    if (ancestors.some((a) => !expanded.has(a))) setExpanded((s) => new Set([...s, ...ancestors]))
  }, [selected])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const toggle = (path: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      n.has(path) ? n.delete(path) : n.add(path)
      return n
    })

  const render = (nodes: TreeNode[], depth: number) =>
    nodes
      .filter((n) => showIgnored || !n.ignored)
      .map((n) => {
        // While searching every folder with results is open.
        const open = !!q || expanded.has(n.path)
        const isMain = n.kind === 'file' && (n.name === 'CLAUDE.md' || n.name === 'AGENTS.md')
        const git = n.kind === 'file' ? props.git[n.path] : dirHasChanges(n, props.git) ? 'M' : undefined
        const sync = n.kind === 'file' ? props.sync[n.path] : undefined
        const foreign = n.kind === 'file' ? props.foreign[n.path] : undefined
        return (
          <li key={n.path}>
            <div
              className={`node${selected === n.path ? ' selected' : ''}${n.ignored ? ' ignored' : ''}`}
              style={{ paddingLeft: 6 + depth * 12 }}
              title={n.path}
              onClick={() => (n.kind === 'dir' ? toggle(n.path) : props.onOpen(n.path))}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, node: n })
              }}
            >
              <span className="chev">{n.kind === 'dir' ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}</span>
              <span className={`ico${n.project ? ' project' : ''}`}>
                {n.kind === 'dir' ? n.project ? <Package size={15} /> : open ? <FolderOpen size={15} /> : <Folder size={15} /> : <FileText size={15} />}
              </span>
              <span className={`name${isMain ? ' main' : ''}`}>{n.name}</span>
              {foreign && (
                <span className="badge foreign" title={t('foreign.badge', { lang: LANG_NAMES[foreign] })}>
                  {foreign.toUpperCase()}
                </span>
              )}
              {sync && sync !== 'synced' && <span className={`dot sync-${sync}`} title={t(`sync.${sync}`)} />}
              {git && <span className={`badge git-${git}`} title={t(`git.${git}`)}>{n.kind === 'dir' ? '•' : git}</span>}
            </div>
            {n.kind === 'dir' && open && <ul>{render(n.children ?? [], depth + 1)}</ul>}
          </li>
        )
      })

  return (
    <aside className="sidebar" onContextMenu={(e) => {
      if (e.target === e.currentTarget) {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, node: null })
      }
    }}>
      <div className="sidebar-head">
        <span style={{ flex: 1 }}>{t('app.files')}</span>
        <button className="icon-btn" title={t('app.newFile')} onClick={() => props.onCreate('')}>
          <FilePlus size={15} />
        </button>
        <button className="icon-btn" title={t('app.showIgnored')} onClick={props.onToggleIgnored} style={showIgnored ? { color: 'var(--accent)' } : undefined}>
          {showIgnored ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button className="icon-btn" title={anyExpanded ? t('app.collapseAll') : t('app.expandAll')} onClick={() => setExpanded(new Set(anyExpanded ? [] : dirPaths(tree)))}>
          {anyExpanded ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
        </button>
        <button
          className="icon-btn"
          title={t('app.search')}
          style={searching ? { color: 'var(--accent)' } : undefined}
          onClick={() => (searching ? closeSearch() : setSearching(true))}
        >
          <Search size={15} />
        </button>
      </div>
      {searching && (
        <div className="sidebar-search">
          <Search size={13} />
          <input
            ref={searchInput}
            autoFocus
            value={query}
            placeholder={t('app.searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
          />
          {query && (
            <button className="icon-btn" title={t('app.clear')} onClick={() => (setQuery(''), searchInput.current?.focus())}>
              <X size={13} />
            </button>
          )}
        </div>
      )}
      <ul className="tree">{render(visible, 0)}</ul>
      {q && !visible.length && <div className="sidebar-empty">{t('app.noResults')}</div>}
      {(props.history.undo > 0 || props.history.redo > 0) && (
        <div className="sidebar-foot">
          <button className="icon-btn" title={t('app.undo')} disabled={!props.history.undo} onMouseDown={(e) => e.preventDefault()} onClick={props.onUndo}>
            <Undo2 size={15} />
          </button>
          <button className="icon-btn" title={t('app.redo')} disabled={!props.history.redo} onMouseDown={(e) => e.preventDefault()} onClick={props.onRedo}>
            <Redo2 size={15} />
          </button>
        </div>
      )}

      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => {
              const n = menu.node
              props.onCreate(n ? (n.kind === 'dir' ? n.path : n.path.split('/').slice(0, -1).join('/')) : '')
              setMenu(null)
            }}
          >
            <FilePlus size={14} /> {t('app.newFile')}
          </button>
          {menu.node && (
            <>
              <button
                onClick={() => {
                  props.onIgnore(menu.node!, !menu.node!.ignored)
                  setMenu(null)
                }}
              >
                {menu.node.ignored ? <Eye size={14} /> : <EyeOff size={14} />} {menu.node.ignored ? t('app.unignore') : t('app.ignore')}
              </button>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(menu.node!.path)
                  setMenu(null)
                }}
              >
                <Copy size={14} /> {t('app.copyPath')}
              </button>
              <button
                className="danger"
                onClick={() => {
                  props.onDelete(menu.node!)
                  setMenu(null)
                }}
              >
                <Trash2 size={14} /> {t('app.delete')}
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  )
}
