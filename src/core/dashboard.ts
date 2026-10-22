import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { flattenFiles, scanTree } from './scan.js'

export interface DocSummary {
  path: string
  title: string
  type: string | null
  status: string | null
  phase: number | null
  updated: string | null
  /** Task id and area, for `type: task` docs (the markode method). */
  id: string | null
  area: string | null
  tasks: { done: number; total: number }
}

export function parseFrontmatter(text: string): Record<string, any> {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  try {
    // Silent: user frontmatter may hold anything, e.g. template placeholders like `{{date}}` (a nested map).
    return YAML.parse(m[1], { logLevel: 'error' }) ?? {}
  } catch {
    return {}
  }
}

/** A frontmatter value shown as text; maps and lists (e.g. an unfilled `{{date}}`) count as missing. */
const asText = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null || typeof v === 'object' ? null : String(v))

export function summarize(root: string): DocSummary[] {
  return flattenFiles(scanTree(root)).flatMap((f) => {
    // Agent config (`.claude/skills`, `.github/prompts`…) holds skills and templates, not project docs.
    if (f.path.split('/').some((part) => part.startsWith('.'))) return []
    const text = fs.readFileSync(path.join(root, f.path), 'utf8')
    const meta = parseFrontmatter(text)
    // The task template (`_TEMPLATE.md`) is not a task.
    if (meta.type === 'task' && f.name.startsWith('_')) return []
    const id = asText(meta.id)
    const total = text.match(/^\s*[-*+] \[[ xX]\]/gm)?.length ?? 0
    const done = text.match(/^\s*[-*+] \[[xX]\]/gm)?.length ?? 0
    const heading = text.match(/^#\s+(.+)$/m)?.[1]
    // "T-001 · Set up the project" → "Set up the project"; the id is shown on its own.
    const title = asText(meta.title) ?? (heading && id ? heading.replace(new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[·:-]\\s*`), '') : heading)
    return {
      path: f.path,
      title: title ?? f.name.replace(/\.md$/i, ''),
      type: asText(meta.type),
      status: asText(meta.status),
      phase: typeof meta.phase === 'number' ? meta.phase : null,
      updated: asText(meta.updated),
      id,
      area: asText(meta.area),
      tasks: { done, total },
    }
  })
}
