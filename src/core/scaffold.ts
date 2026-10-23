import fs from 'node:fs'
import path from 'node:path'
import { linkMainDoc, type MainDoc, missingMainDoc, TEMPLATES_DIR, toPosix } from './config.js'
import { findSubprojects, scanTree } from './scan.js'

export const today = () => new Date().toISOString().slice(0, 10)

export function fill(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
}

export function copyTree(src: string, dest: string, vars: Record<string, string>, created: string[], root: string) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name)
    // Names can hold variables too, e.g. `{{prefix}}-001-set-up.md`.
    const to = path.join(dest, fill(e.name, vars))
    if (e.isDirectory()) {
      fs.mkdirSync(to, { recursive: true })
      copyTree(from, to, vars, created, root)
    } else if (!fs.existsSync(to)) {
      fs.writeFileSync(to, fill(fs.readFileSync(from, 'utf8'), vars))
      created.push(toPosix(path.relative(root, to)))
    }
  }
}


export function createMainDoc(root: string, name: string) {
  const file = path.join(root, name)
  if (fs.existsSync(file)) return
  const text = fs.readFileSync(path.join(TEMPLATES_DIR, 'main.md'), 'utf8')
  fs.writeFileSync(file, fill(text, { name: path.basename(root), date: today() }))
}

const vsCodeFile = (root: string) => path.join(root, '.vscode', 'settings.json')
const HIDDEN = '**/.markode'

/** VS Code's settings, {} when there are none, null when they have comments (JSONC we must not rewrite). */
function readVsCode(root: string): Record<string, any> | null {
  if (!fs.existsSync(vsCodeFile(root))) return {}
  try {
    return JSON.parse(fs.readFileSync(vsCodeFile(root), 'utf8'))
  } catch {
    return null
  }
}

export const isHiddenInVsCode = (root: string) => readVsCode(root)?.['files.exclude']?.[HIDDEN] === true

/** Hide .markode/ in VS Code so the project only shows its own files. False when the settings can't be rewritten. */
export function hideInVsCode(root: string) {
  const settings = readVsCode(root)
  if (!settings) return false
  settings['files.exclude'] = { ...(settings['files.exclude'] ?? {}), [HIDDEN]: true }
  fs.mkdirSync(path.dirname(vsCodeFile(root)), { recursive: true })
  fs.writeFileSync(vsCodeFile(root), JSON.stringify(settings, null, 2) + '\n')
  return true
}

export function showInVsCode(root: string) {
  const settings = readVsCode(root)
  if (!settings?.['files.exclude']?.[HIDDEN]) return
  delete settings['files.exclude'][HIDDEN]
  if (!Object.keys(settings['files.exclude']).length) delete settings['files.exclude']
  fs.writeFileSync(vsCodeFile(root), JSON.stringify(settings, null, 2) + '\n')
}

/** Main docs the project lacks: in the root or a subproject that has only CLAUDE.md or only AGENTS.md. */
export function missingMainDocs(root: string): { path: string; pointsTo: MainDoc }[] {
  return ['', ...findSubprojects(scanTree(root))].flatMap((dir) => {
    const doc = missingMainDoc(path.join(root, dir))
    return doc ? [{ path: path.posix.join(dir, doc), pointsTo: doc === 'CLAUDE.md' ? ('AGENTS.md' as const) : ('CLAUDE.md' as const) }] : []
  })
}

/** Create every missing main doc as a pointer to the existing one; returns the created paths. */
export function linkMainDocs(root: string): string[] {
  return missingMainDocs(root).flatMap((m) => (linkMainDoc(path.join(root, path.posix.dirname(m.path))) ? [m.path] : []))
}
