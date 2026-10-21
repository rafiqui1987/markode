import fs from 'node:fs'
import path from 'node:path'
import { TEMPLATES_DIR, toPosix } from './config.js'

const today = () => new Date().toISOString().slice(0, 10)

function fill(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
}

function copyTree(src: string, dest: string, vars: Record<string, string>, created: string[], root: string) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name)
    const to = path.join(dest, e.name)
    if (e.isDirectory()) {
      fs.mkdirSync(to, { recursive: true })
      copyTree(from, to, vars, created, root)
    } else if (!fs.existsSync(to)) {
      fs.writeFileSync(to, fill(fs.readFileSync(from, 'utf8'), vars))
      created.push(toPosix(path.relative(root, to)))
    }
  }
}

/** Create docs/ from templates; never overwrites existing files. */
export function scaffoldDocs(root: string): string[] {
  const created: string[] = []
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
  copyTree(path.join(TEMPLATES_DIR, 'docs'), path.join(root, 'docs'), { date: today() }, created, root)
  return created
}

export function createMainDoc(root: string, name: string) {
  const file = path.join(root, name)
  if (fs.existsSync(file)) return
  const text = fs.readFileSync(path.join(TEMPLATES_DIR, 'main.md'), 'utf8')
  fs.writeFileSync(file, fill(text, { name: path.basename(root), date: today() }))
}

/** Install (or refresh) the AI skill in .claude/skills/mdrules. */
export function installSkill(root: string) {
  const dir = path.join(root, '.claude', 'skills', 'mdrules')
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(TEMPLATES_DIR, 'skill', 'SKILL.md'), path.join(dir, 'SKILL.md'))
}

export function ensureGitignore(root: string) {
  const file = path.join(root, '.gitignore')
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (text.split('\n').some((l) => ['.mdrules', '.mdrules/', '/.mdrules', '/.mdrules/'].includes(l.trim()))) return
  fs.writeFileSync(file, text + (text && !text.endsWith('\n') ? '\n' : '') + '.mdrules/\n')
}

/** Hide .mdrules/ in VS Code so the project only shows the English files. */
export function hideInVsCode(root: string) {
  const file = path.join(root, '.vscode', 'settings.json')
  let settings: Record<string, any> = {}
  if (fs.existsSync(file)) {
    try {
      settings = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      return false // JSONC with comments: leave it alone rather than destroy it
    }
  }
  settings['files.exclude'] = { ...(settings['files.exclude'] ?? {}), '**/.mdrules': true }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n')
  return true
}
