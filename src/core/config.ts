import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type Lang = 'en' | 'es' | 'fr' | 'pt' | 'de' | 'it'
export const LANGS: Lang[] = ['en', 'es', 'fr', 'pt', 'de', 'it']
export const LANG_NAMES: Record<Lang, string> = { en: 'English', es: 'Español', fr: 'Français', pt: 'Português', de: 'Deutsch', it: 'Italiano' }
export const DEFAULT_SOURCE: Lang = 'en'
export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang)
/** A translation language: one of LANGS, or any code the user added with `markode translate` (e.g. `ja`). */
export const isLangCode = (v: unknown): v is string => typeof v === 'string' && /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(v)
/** Display name of a language code: built-in, or the name given when it was added. */
export const langName = (code: string, config?: ProjectConfig | null) => (isLang(code) ? LANG_NAMES[code] : (config?.langNames?.[code] ?? code))
export const MAIN_DOCS = ['CLAUDE.md', 'AGENTS.md'] as const

export type MainDoc = (typeof MAIN_DOCS)[number]
const otherDoc = (doc: MainDoc): MainDoc => (doc === 'CLAUDE.md' ? 'AGENTS.md' : 'CLAUDE.md')

/**
 * Claude Code reads CLAUDE.md; Codex, Cursor, Gemini and most other agents read AGENTS.md. When a folder
 * has only one, the other can point to it, so every agent finds the same instructions without copying them.
 */
const POINTERS: Record<MainDoc, string> = {
  // Claude Code imports the file: its content is loaded as if it were here.
  'CLAUDE.md': '@AGENTS.md\n',
  'AGENTS.md': "# AGENTS.md\n\nThis project's instructions for AI agents are in [CLAUDE.md](CLAUDE.md): read it and follow it.\n",
}

/** Whether `text`, the content of main doc `doc`, only points to the other main doc. */
export const isPointer = (text: string, doc: MainDoc = 'CLAUDE.md') => text.trim() === POINTERS[doc].trim()

const readText = (abs: string) => {
  try {
    return fs.readFileSync(abs, 'utf8')
  } catch {
    return ''
  }
}

/** The main doc that holds a folder's content (not the one that only points to the other). */
export function contentDoc(dir: string): string | null {
  for (const doc of MAIN_DOCS) {
    const abs = path.join(dir, doc)
    if (!fs.existsSync(abs)) continue
    if (fs.existsSync(path.join(dir, otherDoc(doc))) && isPointer(readText(abs), doc)) continue
    return abs
  }
  return null
}

/** The name of a project's main doc, from the files that exist (null when there is none). */
export function mainDocOf(root: string): string | null {
  const doc = contentDoc(root)
  return doc && path.basename(doc)
}

/** The main doc a folder lacks when it has only the other one (null with both or neither). */
export function missingMainDoc(dir: string): MainDoc | null {
  const present = MAIN_DOCS.filter((d) => fs.existsSync(path.join(dir, d)))
  return present.length === 1 ? otherDoc(present[0]) : null
}

/** Create the main doc a folder lacks, pointing to the one it has. Returns the created name, if any. */
export function linkMainDoc(dir: string): MainDoc | null {
  const missing = missingMainDoc(dir)
  if (missing) fs.writeFileSync(path.join(dir, missing), POINTERS[missing])
  return missing
}

/** In a folder with only AGENTS.md, add a CLAUDE.md that imports it, so Claude Code loads it too. */
export const linkAgentsDoc = (dir: string) => missingMainDoc(dir) === 'CLAUDE.md' && !!linkMainDoc(dir)

/** Personal, git-ignored settings of this project (the source language lives in the main doc). */
export interface ProjectConfig {
  mainDoc: string | null
  /** Translation languages enabled for this user: built-in codes or ones added by hand. */
  langs: string[]
  /** Names of languages added by hand (`ja` → `Japanese`); the AI translates into them by name. */
  langNames?: Record<string, string>
  /** Specs and planning structure chosen at init (see core/sdd.ts). */
  workflow?: 'none' | 'markode' | 'openspec' | 'speckit'
  /** How proposals are organized, once activated (see core/proposals.ts). */
  proposals?: 'general' | 'structured'
  /** The user doesn't want a CLAUDE.md / AGENTS.md pointing to the other one: don't offer it again. */
  skipLink?: boolean
  initializedAt?: string
}

/** Package root: works from src/ (tsx) and from dist/ (bundled). */
export const PKG_ROOT = (() => {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  while (!fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir)
  return dir
})()

export const TEMPLATES_DIR = path.join(PKG_ROOT, 'templates')
export const WEB_DIR = path.join(PKG_ROOT, 'dist', 'web')

/** Global, per-user storage (rule presets). */
export const GLOBAL_DIR = process.env.MARKODE_HOME ?? path.join(os.homedir(), '.markode')

export const stateDir = (root: string) => path.join(root, '.markode')
const configFile = (root: string) => path.join(stateDir(root), 'config.json')

export function readConfig(root: string): ProjectConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(root), 'utf8'))
    // v0.1 stored a single `lang`.
    const langs = Array.isArray(raw.langs) ? raw.langs : raw.lang ? [raw.lang] : []
    return { mainDoc: raw.mainDoc ?? null, langs: langs.filter(isLangCode), langNames: raw.langNames, workflow: raw.workflow, proposals: raw.proposals, skipLink: raw.skipLink === true || undefined, initializedAt: raw.initializedAt }
  } catch {
    return null
  }
}

export function writeConfig(root: string, config: ProjectConfig) {
  fs.mkdirSync(stateDir(root), { recursive: true })
  fs.writeFileSync(configFile(root), JSON.stringify(config, null, 2) + '\n')
}

/** Resolve a repo-relative path and refuse anything outside the root. */
export function safeResolve(root: string, rel: string): string {
  const abs = path.resolve(root, rel)
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`Path outside project: ${rel}`)
  return abs
}

export const toPosix = (p: string) => p.split(path.sep).join('/')

// ------------------------------------------------------------ editor settings (global, per user)

export interface EditorSettings {
  font: string
  size: number
  lineHeight: number
  /** Side padding of the editor, in px ("sangría"). */
  padding: number
  width: 'full' | 'readable'
  /** Wrap long lines; when false, long lines and wide tables scroll horizontally. */
  wrap: boolean
  /** Language of markode' own menus; independent of the language the docs are written in. */
  uiLang: string
}

export const DEFAULT_SETTINGS: EditorSettings = { font: 'inter', size: 15, lineHeight: 1.65, padding: 28, width: 'full', wrap: true, uiLang: 'en' }
const settingsFile = () => path.join(GLOBAL_DIR, 'settings.json')

export function readSettings(): EditorSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeSettings(patch: Partial<EditorSettings>): EditorSettings {
  const next = { ...readSettings(), ...patch }
  fs.mkdirSync(GLOBAL_DIR, { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + '\n')
  return next
}
