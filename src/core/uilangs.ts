import fs from 'node:fs'
import path from 'node:path'
import { GLOBAL_DIR, isLangCode } from './config.js'

/**
 * Interface languages markode has no dictionary for: their strings are translated once by the user's
 * engine and kept per user in `~/.markode/ui-<lang>.json`.
 */
export interface UiStrings {
  name: string
  strings: Record<string, string>
}

const file = (lang: string) => {
  if (!isLangCode(lang)) throw new Error(`Not a language code: ${lang}`)
  return path.join(GLOBAL_DIR, `ui-${lang.toLowerCase()}.json`)
}

export function readUiStrings(lang: string): UiStrings | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file(lang), 'utf8'))
    if (typeof raw.name !== 'string' || !raw.strings || typeof raw.strings !== 'object') return null
    return { name: raw.name, strings: Object.fromEntries(Object.entries(raw.strings).filter((e): e is [string, string] => typeof e[1] === 'string')) }
  } catch {
    return null
  }
}

export function writeUiStrings(lang: string, ui: UiStrings) {
  fs.mkdirSync(GLOBAL_DIR, { recursive: true })
  fs.writeFileSync(file(lang), JSON.stringify(ui, null, 2) + '\n')
}

/** Generated interface languages: code → name. */
export function listUiLangs(): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (const f of fs.readdirSync(GLOBAL_DIR)) {
      const m = /^ui-(.+)\.json$/.exec(f)
      const ui = m && isLangCode(m[1]) ? readUiStrings(m[1]) : null
      if (m && ui) out[m[1]] = ui.name
    }
    return out
  } catch {
    return {}
  }
}
