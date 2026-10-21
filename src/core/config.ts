import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type Lang = 'en' | 'es' | 'fr' | 'pt' | 'de' | 'it'
export const LANGS: Lang[] = ['en', 'es', 'fr', 'pt', 'de', 'it']
export const LANG_NAMES: Record<Lang, string> = { en: 'English', es: 'Español', fr: 'Français', pt: 'Português', de: 'Deutsch', it: 'Italiano' }
export const DEFAULT_SOURCE: Lang = 'en'
export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang)
export const MAIN_DOCS = ['CLAUDE.md', 'AGENTS.md'] as const

/** Personal, git-ignored settings of this project (the source language lives in the main doc). */
export interface ProjectConfig {
  mainDoc: string | null
  /** Translation languages enabled for this user. */
  langs: Lang[]
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
export const GLOBAL_DIR = process.env.MDRULES_HOME ?? path.join(os.homedir(), '.mdrules')

export const stateDir = (root: string) => path.join(root, '.mdrules')
const configFile = (root: string) => path.join(stateDir(root), 'config.json')

export function readConfig(root: string): ProjectConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(root), 'utf8'))
    // v0.1 stored a single `lang`.
    const langs = Array.isArray(raw.langs) ? raw.langs : raw.lang ? [raw.lang] : []
    return { mainDoc: raw.mainDoc ?? null, langs: langs.filter(isLang), initializedAt: raw.initializedAt }
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
}

export const DEFAULT_SETTINGS: EditorSettings = { font: 'inter', size: 15, lineHeight: 1.65, padding: 28, width: 'full', wrap: true }
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
