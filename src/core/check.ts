import fs from 'node:fs'
import path from 'node:path'
import { mainDocOf } from './config.js'
import { summarize } from './dashboard.js'
import { detectAreas } from './method.js'

/**
 * What `/markode sync` keeps consistent in the docs (languages are `/markode translate`): answered
 * proposals to apply, phases whose checklist disagrees with their tasks, the "Projects" table against
 * the projects that exist, and links to docs that no longer exist.
 */
export interface CheckReport {
  /** Proposals marked `answered`: apply them, then delete them. */
  proposals: string[]
  /** A task ticked in its phase that isn't `done`, or `done` and not ticked. */
  phases: { phase: string; task: string; ticked: boolean; status: string }[]
  /** Projects missing from the main doc's table, and rows whose folder is gone; null without a table. */
  projects: { missing: string[]; gone: string[] } | null
  links: { file: string; line: number; target: string }[]
}

const TASK_LINE = /^\s*[-*+] \[([ xX])\] .*?\[[^\]]*\]\(([^)\s]+)\)/
const LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

export function checkDocs(root: string): CheckReport {
  const docs = summarize(root)
  const status = new Map(docs.map((d) => [d.path, d.status ?? '']))
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

  const phases: CheckReport['phases'] = []
  for (const phase of docs.filter((d) => d.type === 'phase')) {
    for (const line of read(phase.path).split('\n')) {
      const m = TASK_LINE.exec(line)
      if (!m) continue
      const task = path.posix.normalize(path.posix.join(path.posix.dirname(phase.path), m[2].split('#')[0]))
      const s = status.get(task)
      if (s === undefined) continue
      const ticked = m[1] !== ' '
      if (ticked !== (s === 'done')) phases.push({ phase: phase.path, task, ticked, status: s })
    }
  }

  const links: CheckReport['links'] = []
  for (const doc of docs) {
    let fenced = false
    read(doc.path)
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
        if (fenced) return
        for (const m of line.matchAll(LINK)) {
          const target = m[1]
          // External, in-page, and template placeholders (`<path>`, `{{var}}`) are not checked.
          if (/^[a-z][\w+.-]*:|^#|^\/|[<{]/i.test(target)) continue
          const file = decodeURIComponent(target.split(/[#?]/)[0])
          if (file && !fs.existsSync(path.join(root, path.dirname(doc.path), file))) links.push({ file: doc.path, line: i + 1, target })
        }
      })
  }

  return { proposals: docs.filter((d) => d.type === 'proposal' && d.status === 'answered').map((d) => d.path), phases, projects: projectsTable(root), links }
}

/** The main doc's "Projects" table (written by the markode method) against the projects found. */
function projectsTable(root: string): CheckReport['projects'] {
  const doc = mainDocOf(root)
  if (!doc) return null
  const text = fs.readFileSync(path.join(root, doc), 'utf8')
  const section = /^### Projects\n([\s\S]*?)(?=^#{1,3} |<!-- markode:workflow:end -->)/m.exec(text)?.[1]
  if (!section) return null
  const listed = [...section.matchAll(/^\|\s*`([^`]+?)\/?`\s*\|/gm)].map((m) => m[1]).filter((d) => d !== 'docs')
  const found = detectAreas(root).dirs
  return { missing: found.filter((d) => !listed.includes(d)), gone: listed.filter((d) => !fs.existsSync(path.join(root, d))) }
}
