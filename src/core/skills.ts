import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import { assertInside, GLOBAL_DIR } from './config.js'

/**
 * Global skills of every agent that follows the Agent Skills standard (agentskills.io):
 * a folder with a SKILL.md whose frontmatter has `name` and `description`.
 */
export type SkillSource = 'claude' | 'agents' | 'codex' | 'gemini' | 'copilot' | 'cursor'

const SOURCE_DIRS: Record<SkillSource, string[]> = {
  claude: ['.claude', 'skills'],
  // Shared folder read by Codex, Copilot and Gemini CLI, and where `npx skills` installs.
  agents: ['.agents', 'skills'],
  codex: ['.codex', 'skills'],
  gemini: ['.gemini', 'skills'],
  copilot: ['.copilot', 'skills'],
  cursor: ['.cursor', 'skills'],
}

/** Where "add to project" copies a skill: Claude Code, and the shared folder the other agents read. */
export const PROJECT_TARGETS = { claude: '.claude/skills', agents: '.agents/skills' } as const
export type ProjectTarget = keyof typeof PROJECT_TARGETS

export interface SkillLocation {
  source: SkillSource
  /** Shown to the user, with ~ for the home folder. */
  path: string
}

export interface Skill {
  /** Real path of the skill folder; identifies it in the API. */
  key: string
  name: string
  /** Folder name: what the copy in a project is called. */
  folder: string
  description: string
  locations: SkillLocation[]
  /** Installed and kept up to date by an app (synced, system skills): read-only. */
  managed: boolean
  /** Support files next to SKILL.md (scripts/, references/, assets/…). */
  files: string[]
  /** The user's tags plus any declared in the frontmatter (`metadata.tags`). */
  tags: string[]
  /** Problems against the standard that can stop an agent from loading the skill. */
  issues: SkillIssue[]
  /** Project folders that already have a skill with this name. */
  installed: ProjectTarget[]
}

export type SkillIssue = 'frontmatter' | 'name' | 'name-dir' | 'description' | 'description-long'

const sourceDir = (source: SkillSource) => path.join(os.homedir(), ...SOURCE_DIRS[source])
const display = (p: string) => (p.startsWith(os.homedir() + path.sep) ? '~' + p.slice(os.homedir().length) : p)

export function skillSources() {
  return (Object.keys(SOURCE_DIRS) as SkillSource[]).map((id) => ({ id, path: display(sourceDir(id)), exists: fs.existsSync(sourceDir(id)) }))
}

// ------------------------------------------------------------ tags (~/.markode/skills.json, never the skill itself)

const tagsFile = () => path.join(GLOBAL_DIR, 'skills.json')

function readTags(): Record<string, string[]> {
  try {
    return JSON.parse(fs.readFileSync(tagsFile(), 'utf8')).tags ?? {}
  } catch {
    return {}
  }
}

export function setSkillTags(name: string, tags: string[]) {
  const all = readTags()
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
  if (clean.length) all[name] = clean
  else delete all[name]
  fs.mkdirSync(GLOBAL_DIR, { recursive: true })
  fs.writeFileSync(tagsFile(), JSON.stringify({ tags: all }, null, 2) + '\n')
  return clean
}

// ------------------------------------------------------------ discovery

interface Found {
  dir: string
  real: string
  source: SkillSource
  managed: boolean
}

/** Skill folders under `dir`, looking into folders without a SKILL.md; those an app keeps (synced/, .system/) are managed. */
function findSkills(dir: string, source: SkillSource, managed: boolean, depth = 0): Found[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((e) => {
    const abs = path.join(dir, e.name)
    let real: string
    try {
      if (!fs.statSync(abs).isDirectory()) return []
      real = fs.realpathSync(abs)
    } catch {
      return [] // broken symlink
    }
    if (fs.existsSync(path.join(abs, 'SKILL.md'))) return [{ dir: abs, real, source, managed }]
    return depth < 2 ? findSkills(abs, source, managed || e.name === 'synced' || e.name.startsWith('.'), depth + 1) : []
  })
}

function frontmatter(text: string): Record<string, any> | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  try {
    const data = YAML.parse(m[1], { logLevel: 'error' })
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      // parentPath is Node 20.12+; older versions call it `path`.
      .map((e) => ({ e, rel: path.relative(dir, path.join(e.parentPath ?? (e as { path?: string }).path ?? dir, e.name)).split(path.sep).join('/') }))
      .filter(({ e, rel }) => e.isFile() && rel !== 'SKILL.md')
      .map(({ rel }) => rel)
      .sort()
      .slice(0, 100)
  } catch {
    return []
  }
}

export function listSkills(root: string): Skill[] {
  const byReal = new Map<string, Found[]>()
  for (const source of Object.keys(SOURCE_DIRS) as SkillSource[]) {
    for (const f of findSkills(sourceDir(source), source, false)) byReal.set(f.real, [...(byReal.get(f.real) ?? []), f])
  }
  const userTags = readTags()
  const skills: Skill[] = []
  for (const [real, found] of byReal) {
    const text = fs.readFileSync(path.join(real, 'SKILL.md'), 'utf8')
    const fm = frontmatter(text)
    const folder = path.basename(found[0].dir)
    const name = typeof fm?.name === 'string' ? fm.name : folder
    const description = typeof fm?.description === 'string' ? fm.description.trim() : ''
    const issues: SkillIssue[] = []
    if (!fm) issues.push('frontmatter')
    else {
      if (typeof fm.name !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name) || fm.name.length > 64) issues.push('name')
      else if (fm.name !== folder) issues.push('name-dir')
      if (!description) issues.push('description')
      else if (description.length > 1024) issues.push('description-long')
    }
    const declared = fm?.metadata?.tags
    const metaTags = Array.isArray(declared) ? declared.map(String) : typeof declared === 'string' ? declared.split(',') : []
    skills.push({
      key: real,
      name,
      folder,
      description,
      locations: found.map((f) => ({ source: f.source, path: display(f.dir) })),
      managed: found.every((f) => f.managed),
      files: listFiles(real),
      tags: [...new Set([...(userTags[name] ?? []), ...metaTags.map((t) => t.trim().toLowerCase()).filter(Boolean)])],
      issues,
      installed: (Object.keys(PROJECT_TARGETS) as ProjectTarget[]).filter((t) => fs.existsSync(path.join(root, PROJECT_TARGETS[t], folder, 'SKILL.md'))),
    })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/** The skill with this key, looked up again so the API can only ever reach discovered skill folders. */
export function getSkill(root: string, key: unknown): Skill {
  const skill = typeof key === 'string' ? listSkills(root).find((s) => s.key === key) : undefined
  if (!skill) throw Object.assign(new Error('Skill not found'), { code: 'ENOENT' })
  return skill
}

/** Which agents the project seems to use, to preselect where a skill is copied. */
export function projectTargets(root: string): ProjectTarget[] {
  const has = (p: string) => fs.existsSync(path.join(root, p))
  const out: ProjectTarget[] = []
  if (has('.claude') || has('CLAUDE.md')) out.push('claude')
  if (has('.agents') || has('AGENTS.md') || has('.codex') || has('.gemini') || has('.github/skills')) out.push('agents')
  return out.length ? out : ['claude']
}

/** Copy a skill folder into the project for each target; symlinks are copied as the files they point to. */
export function installSkill(root: string, skill: Skill, targets: ProjectTarget[], overwrite: boolean) {
  const dests = targets.map((t) => path.join(root, PROJECT_TARGETS[t], skill.folder))
  const existing = dests.filter((d) => fs.existsSync(d))
  if (existing.length && !overwrite) return { conflict: existing.map((d) => path.relative(root, d).split(path.sep).join('/')) }
  for (const dest of dests) {
    assertInside(dest, root)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(skill.key, dest, { recursive: true, dereference: true })
  }
  return { ok: true }
}
