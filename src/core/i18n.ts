import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { type Lang, langName, readConfig, stateDir } from './config.js'
import { detectLang } from './langdetect.js'
import { projectSourceLang } from './rules.js'
import { flattenFiles, scanTree } from './scan.js'

export type SyncStatus = 'synced' | 'outdated' | 'pending-sync' | 'conflict' | 'missing'

interface FileState {
  /** Hashes recorded the last time source and translation were in sync. */
  source: string
  translation: string
}

interface State {
  translations: Partial<Record<string, Record<string, FileState>>>
  /** Files the user chose to keep in a language other than the source one. */
  keepLanguage: Record<string, Lang>
}

const stateFile = (root: string) => path.join(stateDir(root), 'state.json')
export const translationPath = (root: string, lang: string, rel: string) => path.join(stateDir(root), 'i18n', lang, rel)

const hash = (text: string) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)
const readText = (abs: string) => {
  try {
    return fs.readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

function readState(root: string): State {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(root), 'utf8'))
    // v0.1 stored translations at the top level.
    if (!raw.translations) return { translations: raw, keepLanguage: {} }
    return { translations: raw.translations ?? {}, keepLanguage: raw.keepLanguage ?? {} }
  } catch {
    return { translations: {}, keepLanguage: {} }
  }
}

function writeState(root: string, state: State) {
  fs.mkdirSync(stateDir(root), { recursive: true })
  fs.writeFileSync(stateFile(root), JSON.stringify(state, null, 2) + '\n')
}

export function fileStatus(root: string, lang: string, rel: string): SyncStatus {
  const source = readText(path.join(root, rel))
  const translation = readText(translationPath(root, lang, rel))
  if (translation === null || source === null) return 'missing'
  const recorded = readState(root).translations[lang]?.[rel]
  // A translation nobody marked as synced is treated as stale.
  if (!recorded) return 'outdated'
  const sourceChanged = hash(source) !== recorded.source
  const translationChanged = hash(translation) !== recorded.translation
  if (sourceChanged && translationChanged) return 'conflict'
  if (sourceChanged) return 'outdated'
  if (translationChanged) return 'pending-sync'
  return 'synced'
}

export interface StatusEntry {
  path: string
  lang: string
  status: SyncStatus
  translation: string
}

export interface ForeignEntry {
  path: string
  detected: Lang
}

export function allStatuses(root: string, lang: string): StatusEntry[] {
  return flattenFiles(scanTree(root)).map((f) => ({
    path: f.path,
    lang,
    status: fileStatus(root, lang, f.path),
    translation: path.relative(root, translationPath(root, lang, f.path)),
  }))
}

/** Files whose prose is not in the source language (minus the ones the user chose to keep). */
export function foreignFiles(root: string, sourceLang: Lang): ForeignEntry[] {
  const { keepLanguage } = readState(root)
  const out: ForeignEntry[] = []
  for (const f of flattenFiles(scanTree(root))) {
    const text = readText(path.join(root, f.path))
    const detected = text ? detectLang(text) : null
    if (detected && detected !== sourceLang && keepLanguage[f.path] !== detected) out.push({ path: f.path, detected })
  }
  return out
}

/** Everything the AI needs for `/markode translate`. */
export function syncReport(root: string) {
  const config = readConfig(root)
  const sourceLang = projectSourceLang(root, config?.mainDoc)
  const langs = (config?.langs ?? []).filter((l) => l !== sourceLang)
  return {
    sourceLang,
    langs,
    /** Language names by code: translate into these (codes added by hand have no built-in name). */
    names: Object.fromEntries([sourceLang, ...langs].map((l) => [l, langName(l, config)])),
    foreign: foreignFiles(root, sourceLang),
    files: langs.flatMap((l) => allStatuses(root, l)),
  }
}

/** Record that source and translation of `rel` are now in sync. */
export function markSynced(root: string, lang: string, rel: string) {
  const source = readText(path.join(root, rel))
  const translation = readText(translationPath(root, lang, rel))
  if (source === null) throw new Error(`Source not found: ${rel}`)
  if (translation === null) throw new Error(`Translation not found: ${path.relative(root, translationPath(root, lang, rel))}`)
  const state = readState(root)
  state.translations[lang] ??= {}
  state.translations[lang]![rel] = { source: hash(source), translation: hash(translation) }
  writeState(root, state)
}

/** Remember that `rel` stays in its current language; it won't be offered for conversion again. */
export function keepLanguage(root: string, rel: string) {
  const text = readText(path.join(root, rel))
  const detected = text ? detectLang(text) : null
  if (!detected) throw new Error(`Could not detect the language of ${rel}`)
  const state = readState(root)
  state.keepLanguage[rel] = detected
  writeState(root, state)
  return detected
}
