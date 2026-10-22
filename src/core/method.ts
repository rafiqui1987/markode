import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { contentDoc, linkAgentsDoc, TEMPLATES_DIR } from './config.js'
import { contractsGuidance, KIND_LABEL, kindGuidance, type Profile } from './profile.js'
import { copyTree, fill, today } from './scaffold.js'
import { findSubprojects, scanTree } from './scan.js'
import { writeManagedBlock } from './sdd.js'

/**
 * The markode method: a short main doc that points to docs/ (vision, architecture, phases, one file per
 * task with an index). In a monorepo each project (an "area": `apps/web`, `services/api`…) gets the same
 * docs for its own work and its own main doc; the root main doc is the overview of all of them.
 */
export interface Area {
  dir: string
  prefix: string
  /** What kind of project it is and the answers that shape its docs (an app when unset). */
  profile?: Profile
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
 * `unsure` when they were only guessed: top-level folders with their own manifest (e.g. `front/` and
 * `service/`) in a root that is a project itself, without workspaces.
 */
export function detectAreas(root: string): { dirs: string[]; unsure: boolean } {
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
  // No workspaces in a root that is a project: folders with their own manifest may still be separate
  // projects (a front end and a back end); they are only a guess.
  let unsure = false
  if (!globs.length && isProject(root)) {
    const tops = subdirs(root).filter((top) => isProject(path.join(root, top)))
    if (tops.length >= 2 && tops.some((t) => !found.has(t))) tops.forEach((t) => found.add(t)), (unsure = true)
  }
  const dirs = [...found].filter((d) => d && !d.split('/').some((part) => part.startsWith('.') || SKIP.has(part)) && isDir(path.join(root, d)))
  // A folder holding other projects (e.g. `apps/` with its own package.json) is not one itself.
  return { dirs: dirs.filter((d) => !dirs.some((o) => o.startsWith(d + '/'))).sort(), unsure }
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

/** Write the method's few starting docs (never overwriting) and each area's; the rest is created when needed. */
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
    let doc = contentDoc(dir)
    if (!doc) {
      doc = path.join(dir, mainDoc)
      fs.writeFileSync(doc, fill(fs.readFileSync(path.join(TEMPLATES_DIR, 'method', 'area-main.md'), 'utf8'), vars))
      created.push(path.posix.join(a.dir, mainDoc))
    }
    // Claude Code users: an area with only AGENTS.md gets a CLAUDE.md that imports it.
    if (claudeUsed(root, mainDoc) && linkAgentsDoc(dir)) created.push(path.posix.join(a.dir, 'CLAUDE.md'))
    writeManagedBlock(doc, areaBlock(a, vars.up, mainDoc), true)
  }
  return created
}

const claudeUsed = (root: string, mainDoc: string) => mainDoc === 'CLAUDE.md' || fs.existsSync(path.join(root, 'CLAUDE.md'))

function areaBlock(a: Area, up: string, mainDoc: string) {
  const guidance = a.profile && kindGuidance(a.profile)
  return [
    `- Tasks: one file per task in \`docs/tasks/\`, prefix \`${a.prefix}\`; the status is in each file's frontmatter`,
    ...(guidance ? [`- ${guidance}`] : []),
    `- Decisions of this project: \`docs/ARCHITECTURE.md\` (created with the first one) · shared by several projects: \`${up}docs/architecture/\``,
    `- Overview of the repository and the other projects: \`${up}${mainDoc}\``,
  ].join('\n')
}

export interface MethodContext {
  /** The root project's kind and answers (a single project; in a monorepo each area has its own). */
  profile?: Profile
  /** Where a repository of services keeps its contracts. */
  contracts?: string | null
  /** Docs the project already had, kept as the official ones. */
  existing?: string[]
}

/** The workflow section of the root main doc: map of the projects, session protocol and where everything lives. */
export function methodSection(areas: Area[], root?: string, ctx: MethodContext = {}): string {
  const taskDirs = ['docs/tasks', ...areas.map((a) => `${a.dir}/docs/tasks`)].join(' ')
  const map = areas.length
    ? [
        '',
        '### Projects',
        '',
        'Each project has its own `CLAUDE.md`/`AGENTS.md` and `docs/` (architecture, tasks, proposals). This file and the root `docs/` hold the overview and what is shared by several projects.',
        '',
        '| Project | Kind | What it is | Docs | Task prefix |',
        '|---|---|---|---|---|',
        ...areas.map((a) => `| \`${a.dir}/\` | ${KIND_LABEL[a.profile?.kind ?? 'app']} | ${(root && areaDescription(root, a.dir).replace(/\|/g, '\\|')) || '<!-- one line -->'} | \`${a.dir}/docs/\` | ${a.prefix} |`),
        `| \`docs/\` | | Vision, shared architecture, phases and tasks across projects | \`docs/\` | ${rootPrefix(areas)} |`,
        ...(ctx.contracts ? ['', contractsGuidance(ctx.contracts)] : []),
      ]
    : []
  const guidance = !areas.length && ctx.profile && kindGuidance(ctx.profile)
  const about = guidance ? ['', '### This project', '', guidance] : []
  const existing = ctx.existing?.length
    ? ['', '### Existing docs', '', 'These are the official docs: update them instead of creating new ones in their place.', '', ...ctx.existing.map((d) => `- \`${d}\``)]
    : []
  return [
    '## Workflow (markode method)',
    '',
    'Docs are created when there is something real to write (where each thing goes and templates: skill `markode-method`): vision `docs/vision.md` · architecture `docs/architecture/` · phases `docs/phases/` · tasks `docs/tasks/`.',
    ...about,
    ...map,
    ...existing,
    '',
    '### Session start',
    '',
    '1. `/markode sync`: apply proposals the user answered while no session was open, and fix what is out of date.',
    `2. Find tasks in progress: \`grep -rl "^status: in-progress" --include=*.md ${taskDirs}\`.`,
    '3. Open the one with the most recent `updated`, read its "Next step" and tell the user in one line where we left off.',
    '4. If there are none, ask the user what to work on.',
    '',
    'When the user asks what is pending or where things stand: `/markode-status`.',
    '',
    '### During the session',
    '',
    `- Read only what the task needs: its file, ${areas.length ? 'the `CLAUDE.md`/`AGENTS.md` and `docs/` of its project, ' : ''}and the one file in \`docs/architecture/\` that applies.`,
    '- Tick acceptance criteria as they are met and keep "Next step" current.',
    '- Before replacing a decision, propose it with the reasons; then update it in its one place.',
    '',
    '### Tasks',
    '',
    '- The user defines tasks: propose them, but create them only when asked (`/markode-new-task`).',
    `- One task = one file in ${areas.length ? '`<project>/docs/tasks/`; tasks across projects in `docs/tasks/`' : '`docs/tasks/`'}, prefix \`${rootPrefix(areas)}\`${areas.length ? ' at the root' : ''}. Its status lives only in its frontmatter; each phase lists its tasks.`,
    '- At the end of a session: `/markode-close-session` (it ends with `/markode sync`).',
    '',
    '### Documentation without redundancy',
    '',
    '- Write only what the code can\'t tell: decisions and why, hidden conventions, the state of the work.',
    '- Each fact lives in one place; everything else links to it.',
    areas.length ? '- A decision affecting one project goes in `<project>/docs/ARCHITECTURE.md`; several projects, in `docs/architecture/`.' : '- Decisions go in `docs/architecture/`, one file per topic.',
    '- Main docs hold orientation, rules and commands only: never decisions or task lists.',
  ].join('\n')
}

/** The method's procedures as skills (with their templates): docs, new task, status and closing a session. */
export function installMethodSkills(root: string) {
  const src = path.join(TEMPLATES_DIR, 'method', 'skills')
  for (const name of fs.readdirSync(src)) fs.cpSync(path.join(src, name), path.join(root, '.claude', 'skills', name), { recursive: true })
}
