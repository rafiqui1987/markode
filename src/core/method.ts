import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { MAIN_DOCS, TEMPLATES_DIR } from './config.js'
import { copyTree, fill, today } from './scaffold.js'
import { findSubprojects, scanTree } from './scan.js'
import { writeManagedBlock } from './sdd.js'

/**
 * The mdrules method: a short main doc that points to docs/ (vision, architecture, phases, one file per
 * task with an index). In a monorepo each project (an "area": `apps/web`, `services/api`…) gets the same
 * docs for its own work and its own main doc; the root main doc is the overview of all of them.
 */
export interface Area {
  dir: string
  prefix: string
}

const SKIP = new Set(['docs', 'node_modules', 'dist', 'build', 'coverage', 'tmp', 'vendor', 'target'])
/** Files that make a folder a project of its own (or its own git repository). */
const MANIFESTS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', 'deno.json', '.git']

const isDir = (abs: string) => !!fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory()
const subdirs = (abs: string) => {
  try {
    return fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).map((e) => e.name)
  } catch {
    return []
  }
}
const isProject = (abs: string) => MANIFESTS.some((m) => fs.existsSync(path.join(abs, m)))

/**
 * The projects of a monorepo, one per package or repository: workspace packages (`apps/*` expanded),
 * folders with their own main doc and, when the root isn't a project itself (a folder of repositories),
 * folders up to two levels down with a manifest or their own `.git`. Only the innermost ones count.
 */
export function detectAreas(root: string): string[] {
  const globs: string[] = []
  try {
    const ws = YAML.parse(fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'), { logLevel: 'error' })
    if (Array.isArray(ws?.packages)) globs.push(...ws.packages)
  } catch {}
  try {
    const ws = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).workspaces
    globs.push(...(Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : []))
  } catch {}
  const found = new Set<string>(findSubprojects(scanTree(root)))
  for (const glob of globs) {
    const g = String(glob).replace(/^\.\//, '').replace(/\/+$/, '')
    if (g.startsWith('!')) continue
    const base = g.replace(/\/\*\*?$/, '')
    if (base.includes('*')) continue
    if (base === g) found.add(g)
    else for (const name of subdirs(path.join(root, base))) found.add(`${base}/${name}`)
  }
  if (!isProject(root)) {
    for (const top of subdirs(root)) {
      if (isProject(path.join(root, top))) found.add(top)
      else for (const name of subdirs(path.join(root, top))) if (isProject(path.join(root, top, name))) found.add(`${top}/${name}`)
    }
  }
  const dirs = [...found].filter((d) => d && !d.split('/').some((part) => part.startsWith('.') || SKIP.has(part)) && isDir(path.join(root, d)))
  // A folder holding other projects (e.g. `apps/` with its own package.json) is not one itself.
  return dirs.filter((d) => !dirs.some((o) => o.startsWith(d + '/'))).sort()
}

/** A project's one-line description, from its manifest, for the root overview. */
export function areaDescription(root: string, dir: string): string {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf8')).description ?? '').trim()
  } catch {
    return ''
  }
}

const KNOWN_PREFIXES: Record<string, string> = {
  apps: 'APP',
  app: 'APP',
  services: 'SVC',
  service: 'SVC',
  packages: 'PKG',
  libs: 'LIB',
  lib: 'LIB',
  infra: 'INF',
  infrastructure: 'INF',
  proto: 'PRO',
  backend: 'BE',
  frontend: 'FE',
  web: 'WEB',
  api: 'API',
  mobile: 'MOB',
  tools: 'TLS',
  scripts: 'SCR',
}

/** A short task prefix for an area, unique among `used`: e.g. services → SVC, apps/bridge → BRI. */
export function suggestPrefix(dir: string, used: Set<string>): string {
  dir = path.posix.basename(dir)
  const base = KNOWN_PREFIXES[dir.toLowerCase()] ?? (dir.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'AREA')
  let prefix = base
  for (let i = 2; used.has(prefix) || prefix === 'CORE'; i++) prefix = `${base}${i}`
  used.add(prefix)
  return prefix
}

/** Root prefix: CORE for cross-area work in a monorepo, T in a single project. */
export const rootPrefix = (areas: Area[]) => (areas.length ? 'CORE' : 'T')

/** Write the method's docs (never overwriting) and each area's docs and main doc. */
export function scaffoldMethod(root: string, mainDoc: string, areas: Area[]): string[] {
  const created: string[] = []
  const name = path.basename(root)
  copyTree(path.join(TEMPLATES_DIR, 'method', 'root'), root, { date: today(), name, prefix: rootPrefix(areas), area: areas.length ? 'core' : name }, created, root)
  for (const a of areas) {
    // `up` leads from the area back to the root, for links to the shared docs.
    const vars = { date: today(), name, prefix: a.prefix, area: a.dir, up: '../'.repeat(a.dir.split('/').length) }
    const dir = path.join(root, a.dir)
    copyTree(path.join(TEMPLATES_DIR, 'method', 'area'), dir, vars, created, root)
    // The area keeps its own main doc if it has one; otherwise it gets one named like the root's.
    let doc = MAIN_DOCS.map((d) => path.join(dir, d)).find((f) => fs.existsSync(f))
    if (!doc) {
      doc = path.join(dir, mainDoc)
      fs.writeFileSync(doc, fill(fs.readFileSync(path.join(TEMPLATES_DIR, 'method', 'area-main.md'), 'utf8'), vars))
      created.push(path.posix.join(a.dir, mainDoc))
    }
    writeManagedBlock(doc, areaBlock(a, vars.up, mainDoc), true)
  }
  return created
}

function areaBlock(a: Area, up: string, mainDoc: string) {
  return [
    `- Tasks: prefix \`${a.prefix}\` · index in \`docs/TASKS.md\` · one file per task in \`docs/tasks/\``,
    `- Architecture of this project: \`docs/ARCHITECTURE.md\` · shared by several projects: \`${up}docs/architecture/\``,
    `- Overview of the repository and the other projects: \`${up}${mainDoc}\``,
  ].join('\n')
}

/** The workflow section of the root main doc: map of the projects, session protocol and where everything lives. */
export function methodSection(areas: Area[], root?: string): string {
  const taskDirs = ['docs/tasks', ...areas.map((a) => `${a.dir}/docs/tasks`)].join(' ')
  const map = areas.length
    ? [
        '',
        '### Projects',
        '',
        'Each project has its own `CLAUDE.md`/`AGENTS.md` and `docs/` (architecture, tasks, proposals). This file and the root `docs/` hold the overview and what is shared by several projects.',
        '',
        '| Project | What it is | Docs | Task prefix |',
        '|---|---|---|---|',
        ...areas.map((a) => `| \`${a.dir}/\` | ${(root && areaDescription(root, a.dir).replace(/\|/g, '\\|')) || '<!-- one line -->'} | \`${a.dir}/docs/\` | ${a.prefix} |`),
        `| \`docs/\` | Vision, shared architecture, phases and tasks across projects | \`docs/\` | ${rootPrefix(areas)} |`,
      ]
    : []
  return [
    '## Workflow (mdrules method)',
    '',
    'How we work: `docs/README.md`. Vision: `docs/vision.md` · architecture: `docs/architecture/` · phases: `docs/phases/` · tasks: `docs/TASKS.md`.',
    ...map,
    '',
    '### Session start',
    '',
    `1. Find tasks in progress: \`grep -rl "^status: in-progress" --include=*.md ${taskDirs}\`.`,
    '2. Open the one with the most recent `updated`, read its "Next step" and tell the user in one line where we left off.',
    '3. If there are none, ask the user what to work on.',
    '',
    '### During the session',
    '',
    `- Read only what the task needs: its file, ${areas.length ? 'the `CLAUDE.md`/`AGENTS.md` and `docs/` of its project, ' : ''}and the one file in \`docs/architecture/\` that applies.`,
    '- Tick acceptance criteria as they are met and keep "Next step" current.',
    '- Before replacing a decision, propose it with the reasons; then update it in its one place.',
    '',
    '### Tasks',
    '',
    '- The user defines tasks: propose them, but create them only when asked (`/mdrules-new-task`).',
    `- One task = one file in ${areas.length ? '`<project>/docs/tasks/`; tasks across projects in `docs/tasks/`' : '`docs/tasks/`'}. \`TASKS.md\` is only an index; each phase lists its tasks.`,
    '- At the end of a session: `/mdrules-close-session`.',
    '',
    '### Documentation without redundancy',
    '',
    '- Each fact lives in one place; everything else links to it.',
    areas.length ? '- A decision affecting one project goes in `<project>/docs/ARCHITECTURE.md`; several projects, in `docs/architecture/`.' : '- Decisions go in `docs/architecture/`, one file per topic.',
    '- Main docs hold orientation, rules and commands only: never decisions or task lists.',
  ].join('\n')
}

/** The method's procedures as skills: creating a task and closing a session. */
export function installMethodSkills(root: string) {
  const src = path.join(TEMPLATES_DIR, 'method', 'skills')
  for (const name of fs.readdirSync(src)) {
    const dest = path.join(root, '.claude', 'skills', name)
    fs.mkdirSync(dest, { recursive: true })
    fs.copyFileSync(path.join(src, name, 'SKILL.md'), path.join(dest, 'SKILL.md'))
  }
}
