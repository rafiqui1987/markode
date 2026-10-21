export type SyncStatus = 'synced' | 'outdated' | 'pending-sync' | 'conflict' | 'missing'
export type GitStatus = 'M' | 'A' | 'D' | 'U'
export type Lang = 'en' | 'es' | 'fr' | 'pt' | 'de' | 'it'
export const LANGS: Lang[] = ['en', 'es', 'fr', 'pt', 'de', 'it']
export const LANG_NAMES: Record<Lang, string> = { en: 'English', es: 'Español', fr: 'Français', pt: 'Português', de: 'Deutsch', it: 'Italiano' }

export interface EditorSettings {
  font: string
  size: number
  lineHeight: number
  padding: number
  width: 'full' | 'readable'
  wrap: boolean
}

export interface TreeNode {
  name: string
  path: string
  kind: 'dir' | 'file'
  project?: boolean
  ignored?: boolean
  children?: TreeNode[]
}

export interface Info {
  name: string
  mainDoc: string | null
  sourceLang: Lang
  /** Enabled translation languages (never includes the source one). */
  langs: Lang[]
  git: boolean
}

export interface TreeData {
  tree: TreeNode[]
  git: Record<string, GitStatus>
  sync: Record<string, SyncStatus>
  /** Files whose prose is not in the source language → detected language. */
  foreign: Record<string, Lang>
}

export interface FileData {
  path: string
  content: string
  target: 'source' | 'translation'
  status: SyncStatus | null
}

export interface DocSummary {
  path: string
  title: string
  type: string | null
  status: string | null
  phase: number | null
  updated: string | null
  tasks: { done: number; total: number }
}

export interface Rule {
  id: string
  title: string
  body: string
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? res.statusText)
  return data
}

const q = encodeURIComponent

export const api = {
  info: () => call<Info>('GET', '/api/info'),
  setConfig: (config: { langs?: Lang[]; sourceLang?: Lang }) => call('PUT', '/api/config', config),
  settings: () => call<EditorSettings>('GET', '/api/settings'),
  saveSettings: (s: Partial<EditorSettings>) => call<EditorSettings>('PUT', '/api/settings', s),
  keepLanguage: (path: string) => call('POST', '/api/keep-language', { path }),
  tree: (lang: Lang) => call<TreeData>('GET', `/api/tree?lang=${lang}`),
  file: (path: string, lang: Lang) => call<FileData>('GET', `/api/file?path=${q(path)}&lang=${lang}`),
  save: (path: string, content: string, target: FileData['target'], lang: Lang) => call<{ status: SyncStatus | null }>('PUT', '/api/file', { path, content, target, lang }),
  create: (path: string) => call<{ path: string }>('POST', '/api/file', { path }),
  deletePreview: (path: string) => call<{ kind: TreeNode['kind']; files: number; md: number }>('GET', `/api/delete-preview?path=${q(path)}`),
  remove: (path: string) => call('DELETE', `/api/path?path=${q(path)}`),
  ignore: (path: string, kind: TreeNode['kind'], ignored: boolean) => call('POST', '/api/ignore', { path, kind, ignored }),
  diff: (path: string) => call<{ diff: string }>('GET', `/api/diff?path=${q(path)}`),
  dashboard: () => call<{ docs: DocSummary[] }>('GET', '/api/dashboard'),
  rules: () => call<{ rules: Rule[]; applied: string[]; mainDoc: string | null }>('GET', '/api/rules'),
  saveRule: (rule: Partial<Rule> & { title: string; body: string }) => call<Rule>('PUT', '/api/rules', rule),
  deleteRule: (id: string) => call('DELETE', `/api/rules?id=${q(id)}`),
  applyRules: (ids: string[]) => call('POST', '/api/rules/apply', { ids }),
}

/** Live file-system events from the server; reconnects on drop. */
export function subscribe(onEvent: (e: { event: string; path: string }) => void) {
  let ws: WebSocket
  let closed = false
  const connect = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    ws.onmessage = (m) => onEvent(JSON.parse(m.data))
    ws.onclose = () => !closed && setTimeout(connect, 1000)
  }
  connect()
  return () => {
    closed = true
    ws.close()
  }
}
