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
  /** Listed in .mdrulesignore. */
  ignored?: boolean
  children?: TreeNode[]
}

const ALWAYS_SKIP = new Set(['node_modules', '.git', '.mdrules', 'dist', 'build', '.next', '.turbo', 'coverage', '.venv'])
export const IGNORE_FILE = '.mdrulesignore'

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

/** Tree of every .md file under root; folders without .md files are pruned. */
export function scanTree(root: string): TreeNode[] {
  const gitIgnore = loadIgnore(root, '.gitignore')
  const mdIgnore = loadIgnore(root, IGNORE_FILE)

  function walk(dirAbs: string, parentIgnored: boolean): TreeNode[] {
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
        const ignored = parentIgnored || mdIgnore.ignores(rel + '/')
        const children = walk(abs, ignored)
        if (!children.length) continue
        const project = MAIN_DOCS.some((d) => children.some((c) => c.kind === 'file' && c.name === d))
        nodes.push({ name: e.name, path: rel, kind: 'dir', project: project || undefined, ignored: ignored || undefined, children })
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        if (gitIgnore.ignores(rel)) continue
        const ignored = parentIgnored || mdIgnore.ignores(rel)
        nodes.push({ name: e.name, path: rel, kind: 'file', ignored: ignored || undefined })
      }
    }
    return nodes.sort(compareNodes)
  }

  return walk(root, false)
}

/** Main docs first, then folders, then files — alphabetical inside each group. */
function compareNodes(a: TreeNode, b: TreeNode) {
  const rank = (n: TreeNode) => (n.kind === 'file' && (MAIN_DOCS as readonly string[]).includes(n.name) ? 0 : n.kind === 'dir' ? 1 : 2)
  return rank(a) - rank(b) || a.name.localeCompare(b.name)
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
