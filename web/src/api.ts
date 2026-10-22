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
  uiLang: string
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
  /** Enabled translation languages (never includes the source one): built-in codes or ones added by hand. */
  langs: string[]
  /** Display name of every enabled language code. */
  langNames: Record<string, string>
  git: boolean
  /** Proposals and comments: on when the project has the markode-proposals skill. */
  proposals: { active: boolean; layout: ProposalLayout }
  /** Signs comments (git user.name); null when unknown. */
  author: string | null
}

export type ProposalLayout = 'general' | 'structured'

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
  id: string | null
  area: string | null
  tasks: { done: number; total: number }
}

export type SkillSource = 'claude' | 'agents' | 'codex' | 'gemini' | 'copilot' | 'cursor'
export type ProjectTarget = 'claude' | 'agents'
export type SkillIssue = 'frontmatter' | 'name' | 'name-dir' | 'description' | 'description-long'

export interface Skill {
  key: string
  name: string
  folder: string
  description: string
  locations: { source: SkillSource; path: string }[]
  managed: boolean
  files: string[]
  tags: string[]
  issues: SkillIssue[]
  installed: ProjectTarget[]
}

export interface SkillsData {
  skills: Skill[]
  sources: { id: SkillSource; path: string; exists: boolean }[]
  /** Targets preselected for "add to project", from the agents the project uses. */
  targets: ProjectTarget[]
}

export interface Progress {
  done: number
  total: number
}

/** OpenSpec and Spec Kit structures found in the project (see src/core/sdd.ts). */
export interface SddSummary {
  openspec?: {
    changes: { id: string; title: string; path: string; artifacts: { proposal: boolean; design: boolean; tasks: boolean; specs: number }; tasks: Progress }[]
    specs: { id: string; path: string }[]
    archived: { id: string; path: string }[]
  }
  speckit?: {
    constitution: { path: string; filled: boolean } | null
    features: { id: string; title: string; path: string; artifacts: { spec: boolean; plan: boolean; tasks: boolean }; tasks: Progress }[]
  }
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
  setProposals: (active: boolean, layout: ProposalLayout) => call<Info['proposals']>('PUT', '/api/proposals', { active, layout }),
  setConfig: (config: { langs?: string[]; langNames?: Record<string, string>; sourceLang?: Lang }) => call('PUT', '/api/config', config),
  translations: () => call<{ pending: number }>('GET', '/api/translations'),
  waiting: () => call<{ paths: string[] }>('GET', '/api/waiting'),
  settings: () => call<EditorSettings>('GET', '/api/settings'),
  saveSettings: (s: Partial<EditorSettings>) => call<EditorSettings>('PUT', '/api/settings', s),
  keepLanguage: (path: string) => call('POST', '/api/keep-language', { path }),
  tree: (lang: string) => call<TreeData>('GET', `/api/tree?lang=${lang}`),
  file: (path: string, lang: string) => call<FileData>('GET', `/api/file?path=${q(path)}&lang=${lang}`),
  save: (path: string, content: string, target: FileData['target'], lang: string) => call<{ status: SyncStatus | null }>('PUT', '/api/file', { path, content, target, lang }),
  create: (path: string) => call<{ path: string }>('POST', '/api/file', { path }),
  createDir: (path: string) => call<{ path: string }>('POST', '/api/dir', { path }),
  deletePreview: (path: string) => call<{ kind: TreeNode['kind']; files: number; md: number }>('GET', `/api/delete-preview?path=${q(path)}`),
  remove: (path: string) => call('DELETE', `/api/path?path=${q(path)}`),
  ignore: (path: string, kind: TreeNode['kind'], ignored: boolean) => call('POST', '/api/ignore', { path, kind, ignored }),
  diff: (path: string) => call<{ diff: string }>('GET', `/api/diff?path=${q(path)}`),
  dashboard: () => call<{ docs: DocSummary[]; sdd: SddSummary }>('GET', '/api/dashboard'),
  rules: () => call<{ rules: Rule[]; applied: string[]; mainDoc: string | null }>('GET', '/api/rules'),
  saveRule: (rule: Partial<Rule> & { title: string; body: string }) => call<Rule>('PUT', '/api/rules', rule),
  deleteRule: (id: string) => call('DELETE', `/api/rules?id=${q(id)}`),
  applyRules: (ids: string[]) => call('POST', '/api/rules/apply', { ids }),
  skills: () => call<SkillsData>('GET', '/api/skills'),
  setSkillTags: (name: string, tags: string[]) => call<{ tags: string[] }>('PUT', '/api/skills/tags', { name, tags }),
  skillFile: (key: string) => call<FileData>('GET', `/api/skills/file?key=${q(key)}`),
  saveSkillFile: (key: string, content: string) => call<{ status: null }>('PUT', '/api/skills/file', { key, content }),
  installSkill: (key: string, targets: ProjectTarget[], overwrite: boolean) => call('POST', '/api/skills/install', { key, targets, overwrite }),
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
