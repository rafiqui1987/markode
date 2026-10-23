import fs from 'node:fs'
import path from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { MAIN_DOCS, toPosix } from './config.js'

export interface TreeNode {
  name: string
  path: string
  kind: 'dir' | 'file'
  /** Folder that holds its own CLAUDE.md / AGENTS.md (monorepo package). */
  project?: boolean
  /** Listed in .markodeignore, or archived. */
  ignored?: boolean
  /** An applied proposal kept for the user (`proposals/…/applied/`): always ignored, by markode and agents. */
  archived?: boolean
  children?: TreeNode[]
}

const ALWAYS_SKIP = new Set(['node_modules', '.git', '.markode', 'dist', 'build', '.next', '.turbo', 'coverage', '.venv'])
export const IGNORE_FILE = '.markodeignore'

function loadIgnore(root: string, file: string): Ignore {
  const ig = ignore()
  try {
    ig.add(fs.readFileSync(path.join(root, file), 'utf8'))
  } catch {}
  return ig
}

export function readIgnoreList(root: string): string[] {
  try {
    return fs
      .readFileSync(path.join(root, IGNORE_FILE), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  } catch {
    return []
  }
}

export function setIgnored(root: string, rel: string, kind: 'dir' | 'file', ignored: boolean) {
  const entry = kind === 'dir' ? `${rel}/` : rel
  const lines = readIgnoreList(root).filter((l) => l !== entry && l !== rel)
  if (ignored) lines.push(entry)
  fs.writeFileSync(path.join(root, IGNORE_FILE), lines.length ? lines.join('\n') + '\n' : '')
}

/**
 * Paths the file watcher skips: the same folders the scan never enters (ALWAYS_SKIP and
 * .gitignore), so it doesn't walk caches or dependencies. `isDir` is unknown before a path is
 * stat'ed; then it is skipped if ignored as either a file or a folder.
 */
export function watchSkips(root: string): (rel: string, isDir?: boolean) => boolean {
  const gitIgnore = loadIgnore(root, '.gitignore')
  return (rel, isDir) => {
    if (!rel || rel.startsWith('..')) return false
    if (rel.split('/').some((s) => ALWAYS_SKIP.has(s))) return true
    if (isDir !== false && gitIgnore.ignores(rel + '/')) return true
    return isDir !== true && gitIgnore.ignores(rel)
  }
}

/** Where applied proposals are kept: an `applied/` folder inside a `proposals/` folder. */
export const isArchive = (rel: string) => {
  const parts = rel.split('/')
  return parts[parts.length - 1] === 'applied' && parts.slice(0, -1).includes('proposals')
}

/** Tree of every .md file under root; folders without .md files are pruned, except empty ones (just created). */
export function scanTree(root: string): TreeNode[] {
  const gitIgnore = loadIgnore(root, '.gitignore')
  const mdIgnore = loadIgnore(root, IGNORE_FILE)

  function walk(dirAbs: string, parentIgnored: boolean, parentArchived: boolean): TreeNode[] {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true })
    } catch {
      return []
    }
    const nodes: TreeNode[] = []
    for (const e of entries) {
      if (ALWAYS_SKIP.has(e.name)) continue
      const abs = path.join(dirAbs, e.name)
      const rel = toPosix(path.relative(root, abs))
      if (e.isDirectory()) {
        if (gitIgnore.ignores(rel + '/')) continue
        const archived = parentArchived || isArchive(rel)
        const ignored = parentIgnored || archived || mdIgnore.ignores(rel + '/')
        const children = walk(abs, ignored, archived)
        if (!children.length && !isEmptyDir(abs)) continue
        const project = MAIN_DOCS.some((d) => children.some((c) => c.kind === 'file' && c.name === d))
        nodes.push({ name: e.name, path: rel, kind: 'dir', project: project || undefined, ignored: ignored || undefined, archived: archived || undefined, children })
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        if (gitIgnore.ignores(rel)) continue
        const ignored = parentIgnored || mdIgnore.ignores(rel)
        nodes.push({ name: e.name, path: rel, kind: 'file', ignored: ignored || undefined, archived: parentArchived || undefined })
      }
    }
    return nodes.sort(compareNodes)
  }

  return walk(root, false, false)
}

function isEmptyDir(abs: string) {
  try {
    return fs.readdirSync(abs).length === 0
  } catch {
    return false
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders first, then files, as in a file manager; natural order inside each group (2 before 10, case-insensitive). */
function compareNodes(a: TreeNode, b: TreeNode) {
  return (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1) || collator.compare(a.name, b.name)
}

export function flattenFiles(nodes: TreeNode[], includeIgnored = false): TreeNode[] {
  const out: TreeNode[] = []
  for (const n of nodes) {
    if (n.ignored && !includeIgnored) continue
    if (n.kind === 'file') out.push(n)
    else out.push(...flattenFiles(n.children ?? [], includeIgnored))
  }
  return out
}

/** Folders (other than root) holding their own CLAUDE.md / AGENTS.md. */
export function findSubprojects(nodes: TreeNode[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    if (n.kind !== 'dir') continue
    if (n.project) out.push(n.path)
    out.push(...findSubprojects(n.children ?? []))
  }
  return out
}
