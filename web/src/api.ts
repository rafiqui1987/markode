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
  /** An applied proposal kept for the user: always ignored. */
  archived?: boolean
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
  /** CLAUDE.md / AGENTS.md the project lacks (empty once the user declined): `markode link` adds them. */
  unlinked: { path: string; pointsTo: string }[]
  /** Modules on in this project (the viewer is always on). */
  features: Record<Feature, boolean>
}

/** What markode adds to a project besides the viewer; see src/core/features.ts. */
export type Feature = 'agent' | 'rules' | 'proposals' | 'live' | 'translations' | 'dashboard' | 'skills' | 'vscode'
export const FEATURES: Feature[] = ['agent', 'rules', 'proposals', 'live', 'translations', 'dashboard', 'skills', 'vscode']
/** Modules that only work with the AI agent. */
export const REQUIRES: Partial<Record<Feature, Feature>> = { rules: 'agent', proposals: 'agent', live: 'agent', translations: 'agent' }

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
  /** For each kind of agent the project uses: whether it can use the skill here, and from where. */
  status: Partial<Record<ProjectTarget, SkillStatus>>
  /** Project copies whose SKILL.md differs from the global one. */
  differs: ProjectTarget[]
}

/** global: active everywhere, nothing to do · project: shared with the team · both: two copies · missing: another agent's. */
export type SkillStatus = 'global' | 'project' | 'both' | 'missing'

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

/** A content search across the project's docs (see src/core/search.ts). */
export interface SearchQuery {
  q: string
  case: boolean
  word: boolean
  regex: boolean
  /** Match the text as it reads, without Markdown syntax. */
  rendered: boolean
  include: string
  exclude: string
  /** Also search ignored files. */
  ignored: boolean
}

export interface SearchMatch {
  line: number
  col: number
  len: number
  preview: string
  start: number
  end: number
  replaceable: boolean
}

export interface SearchResult {
  files: { path: string; matches: SearchMatch[] }[]
  total: number
  truncated: boolean
}

/** Where to put the cursor when a doc opens: a match of the content search. */
export interface Reveal {
  line: number
  col: number
  len: number
}

const searchParams = (s: SearchQuery): Record<string, string> => ({
  q: s.q,
  case: s.case ? '1' : '',
  word: s.word ? '1' : '',
  regex: s.regex ? '1' : '',
  rendered: s.rendered ? '1' : '',
  include: s.include,
  exclude: s.exclude,
  ignored: s.ignored ? '1' : '',
})

async function call<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method,
    signal,
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
  setFeature: (feature: Feature, on: boolean) => call<Record<Feature, boolean>>('PUT', '/api/features', { feature, on }),
  setProposals: (active: boolean, layout: ProposalLayout) => call<Info['proposals']>('PUT', '/api/proposals', { active, layout }),
  setConfig: (config: { langs?: string[]; langNames?: Record<string, string>; sourceLang?: Lang }) => call('PUT', '/api/config', config),
  translations: () => call<{ pending: number }>('GET', '/api/translations'),
  waiting: () => call<{ paths: string[] }>('GET', '/api/waiting'),
  link: (skip = false) => call<{ created: string[] }>('POST', '/api/link', { skip }),
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
  search: (query: SearchQuery, lang: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ ...searchParams(query), lang })
    return call<SearchResult>('GET', `/api/search?${params}`, undefined, signal)
  },
  /** `path` limits it to one file, `only` to some of its matches (`line:col` keys). */
  replace: (query: SearchQuery, lang: string, replacement: string, path?: string, only?: string[]) =>
    call<{ replaced: number; files: string[] }>('POST', '/api/replace', { ...searchParams(query), lang, replacement, path, only }),
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

/** Live file-system events from the server, and docs to show (`open`); reconnects on drop. */
export function subscribe(onEvent: (e: { type: 'fs' | 'open'; event?: string; path: string }) => void) {
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
