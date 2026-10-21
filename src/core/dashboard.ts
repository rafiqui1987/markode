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
  return flattenFiles(scanTree(root)).map((f) => {
    const text = fs.readFileSync(path.join(root, f.path), 'utf8')
    const meta = parseFrontmatter(text)
    const total = text.match(/^\s*[-*+] \[[ xX]\]/gm)?.length ?? 0
    const done = text.match(/^\s*[-*+] \[[xX]\]/gm)?.length ?? 0
    const heading = text.match(/^#\s+(.+)$/m)?.[1]
    return {
      path: f.path,
      title: asText(meta.title) ?? heading ?? f.name.replace(/\.md$/i, ''),
      type: asText(meta.type),
      status: asText(meta.status),
      phase: typeof meta.phase === 'number' ? meta.phase : null,
      updated: asText(meta.updated),
      tasks: { done, total },
    }
  })
}
