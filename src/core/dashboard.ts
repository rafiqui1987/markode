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
    return YAML.parse(m[1]) ?? {}
  } catch {
    return {}
  }
}

export function summarize(root: string): DocSummary[] {
  return flattenFiles(scanTree(root)).map((f) => {
    const text = fs.readFileSync(path.join(root, f.path), 'utf8')
    const meta = parseFrontmatter(text)
    const total = text.match(/^\s*[-*+] \[[ xX]\]/gm)?.length ?? 0
    const done = text.match(/^\s*[-*+] \[[xX]\]/gm)?.length ?? 0
    const heading = text.match(/^#\s+(.+)$/m)?.[1]
    return {
      path: f.path,
      title: meta.title ?? heading ?? f.name.replace(/\.md$/i, ''),
      type: meta.type ?? null,
      status: meta.status ?? null,
      phase: typeof meta.phase === 'number' ? meta.phase : null,
      updated: meta.updated ? String(meta.updated instanceof Date ? meta.updated.toISOString().slice(0, 10) : meta.updated) : null,
      tasks: { done, total },
    }
  })
}
