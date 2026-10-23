import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { type ProjectConfig, TEMPLATES_DIR, toPosix } from './config.js'
import { copyTree } from './scaffold.js'
import { flattenFiles, scanTree, setIgnored } from './scan.js'

/**
 * Spec-driven development structures a project can use. OpenSpec and Spec Kit are installed with their own
 * CLIs (which also add the agent commands); without them, markode writes a compatible skeleton and a guide.
 */
export type Workflow = NonNullable<ProjectConfig['workflow']>
export const WORKFLOWS: Workflow[] = ['none', 'markode', 'openspec', 'speckit']

/** Agents both tools can install commands for, with each tool's id. */
export const SDD_AGENTS = {
  claude: { label: 'Claude Code', openspec: 'claude', speckit: 'claude' },
  codex: { label: 'Codex', openspec: 'codex', speckit: 'codex' },
  copilot: { label: 'GitHub Copilot', openspec: 'github-copilot', speckit: 'copilot' },
  gemini: { label: 'Gemini CLI', openspec: 'gemini', speckit: 'gemini' },
  cursor: { label: 'Cursor', openspec: 'cursor', speckit: 'cursor-agent' },
} as const
export type SddAgent = keyof typeof SDD_AGENTS

const OPENSPEC_PKG = '@fission-ai/openspec@latest'
const SPECKIT_SRC = 'git+https://github.com/github/spec-kit.git'

/** The structure a project already has, so init doesn't ask (or reinstall) it. */
export function detectWorkflow(root: string): Workflow | null {
  if (fs.existsSync(path.join(root, 'openspec'))) return 'openspec'
  if (fs.existsSync(path.join(root, '.specify'))) return 'speckit'
  return null
}

const has = (cmd: string) => spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0
export const hasUv = () => has('uvx')

/** How to run each tool's official installer, or null when its runtime is missing. */
function installCommand(workflow: 'openspec' | 'speckit', agents: SddAgent[]): string[] | null {
  if (workflow === 'openspec') {
    const tools = agents.map((a) => SDD_AGENTS[a].openspec).join(',') || 'none'
    const runner = has('pnpm') ? ['pnpm', 'dlx'] : has('npx') ? ['npx', '--yes'] : null
    return runner && [...runner, OPENSPEC_PKG, 'init', '--tools', tools, '--no-animation', '--no-copilot-cloud']
  }
  if (!hasUv()) return null
  // --force only merges into a non-empty folder: existing files (constitution, specs) are kept.
  return ['uvx', '--from', SPECKIT_SRC, 'specify', 'init', '--here', '--force', '--non-interactive', '--ignore-agent-tools', '--integration', SDD_AGENTS[agents[0] ?? 'claude'].speckit]
}

export interface InstallResult {
  /** True when the official CLI ran; false when only the skeleton was written. */
  official: boolean
  /** Why the CLI didn't run or failed (last lines of its output). */
  error?: string
  created: string[]
  /** Agent command folders hidden in markode (still on disk). */
  ignored: string[]
}

/** Run the tool's installer (falling back to the skeleton), then add the guide and hide the agent files it added. */
export function installWorkflow(root: string, workflow: 'openspec' | 'speckit', agents: SddAgent[], official: boolean): InstallResult {
  const before = new Set(flattenFiles(scanTree(root), true).map((f) => f.path))
  const result: InstallResult = { official: false, created: [], ignored: [] }
  const cmd = official ? installCommand(workflow, agents) : null
  if (cmd) {
    const run = spawnSync(cmd[0], cmd.slice(1), { cwd: root, encoding: 'utf8', timeout: 300_000, shell: process.platform === 'win32', env: { ...process.env, NO_COLOR: '1' } })
    if (run.status === 0) result.official = true
    else result.error = (run.error?.message ?? `${run.stderr ?? ''}\n${run.stdout ?? ''}`).trim().split('\n').slice(-6).join('\n')
  }
  // The skeleton never overwrites, so after an official install it only adds the guide.
  copyTree(path.join(TEMPLATES_DIR, 'sdd', workflow), root, { date: today() }, result.created, root)

  // Commands and skills the CLI installed for each agent: tool internals the user doesn't edit.
  const dirs = new Set<string>()
  for (const f of flattenFiles(scanTree(root), true)) {
    if (before.has(f.path) || !f.path.startsWith('.') || f.path.startsWith('.specify/memory/')) continue
    dirs.add(path.posix.dirname(f.path))
  }
  for (const dir of dirs) setIgnored(root, dir, 'dir', true)
  result.ignored = [...dirs].sort()
  return result
}

const today = () => new Date().toISOString().slice(0, 10)

// ------------------------------------------------------------ main doc block


/** Fixed sections; the markode method builds its own (see core/method.ts). */
const WORKFLOW_TEXT: Record<'openspec' | 'speckit', string> = {
  openspec: [
    '## Workflow',
    '',
    'This project uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) (spec-driven development; guide: `openspec/README.md`):',
    '',
    '- `openspec/specs/<domain>/spec.md` describes how the system behaves today.',
    '- Every change starts in `openspec/changes/<change-id>/` with `proposal.md`, `tasks.md`, an optional `design.md` and delta specs, before any code.',
    '- When it is done, archive it so its delta specs merge into `openspec/specs/`.',
    '- Use the `/opsx:*` commands (or the `openspec` CLI) when available.',
  ].join('\n'),
  speckit: [
    '## Workflow',
    '',
    'This project uses [GitHub Spec Kit](https://github.com/github/spec-kit) (spec-driven development; guide: `specs/README.md`):',
    '',
    '- Principles every change must respect: `.specify/memory/constitution.md`.',
    '- One folder per feature in `specs/NNN-feature-name/`: `spec.md` (what and why), then `plan.md` (how), then `tasks.md`.',
    '- Use the `/speckit-*` commands when available.',
  ].join('\n'),
}

/** Write (or remove, for 'none') the workflow section of the main doc; the rest of the doc is untouched. */
export function applyWorkflowToFile(file: string, workflow: Workflow, text?: string) {
  writeManagedBlock(file, workflow === 'none' ? null : (text ?? (workflow === 'markode' ? null : WORKFLOW_TEXT[workflow])))
}

/**
 * Replace the `markode:<name>` block of a doc (`workflow` by default), add it (at the end, or right after the title with `top`),
 * or remove it when `body` is null.
 */
export function writeManagedBlock(file: string, body: string | null, top = false, name = 'workflow') {
  const START = `<!-- markode:${name}:start -->`
  const END = `<!-- markode:${name}:end -->`
  const text = fs.readFileSync(file, 'utf8')
  const s = text.indexOf(START)
  const e = text.indexOf(END)
  const existing = s >= 0 && e > s ? text.slice(s, e + END.length) : null
  if (body === null) {
    if (existing) fs.writeFileSync(file, text.replace(new RegExp(`\\n*${escapeRe(existing)}\\n?`), '\n'))
    return
  }
  const section = `${START}\n${body}\n${END}`
  if (existing === section) return
  // A function replacer: `$&` or `$'` in the body would otherwise be read as a replacement pattern.
  if (existing) return fs.writeFileSync(file, text.replace(existing, () => section))
  const title = top ? /^# .*\n/m.exec(text) : null
  if (title) return fs.writeFileSync(file, text.slice(0, title.index + title[0].length) + '\n' + section + '\n' + text.slice(title.index + title[0].length))
  fs.writeFileSync(file, text.replace(/\s*$/, '') + '\n\n' + section + '\n')
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ------------------------------------------------------------ dashboard

export interface Progress {
  done: number
  total: number
}

export interface OpenSpecSummary {
  changes: { id: string; title: string; path: string; artifacts: { proposal: boolean; design: boolean; tasks: boolean; specs: number }; tasks: Progress }[]
  specs: { id: string; path: string }[]
  archived: { id: string; path: string }[]
}

export interface SpecKitSummary {
  constitution: { path: string; filled: boolean } | null
  features: { id: string; title: string; path: string; artifacts: { spec: boolean; plan: boolean; tasks: boolean }; tasks: Progress }[]
}

export interface SddSummary {
  openspec?: OpenSpecSummary
  speckit?: SpecKitSummary
}

const dirs = (abs: string) => {
  try {
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

const read = (abs: string) => {
  try {
    return fs.readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

const progress = (text: string | null): Progress => ({ done: text?.match(/^\s*[-*+] \[[xX]\]/gm)?.length ?? 0, total: text?.match(/^\s*[-*+] \[[ xX]\]/gm)?.length ?? 0 })
const heading = (text: string | null) => text?.match(/^#\s+(.+)$/m)?.[1].trim() ?? null

/** Count spec files anywhere under a change's specs/ folder. */
const countSpecs = (abs: string): number => {
  try {
    return fs.readdirSync(abs, { recursive: true }).filter((f) => String(f).endsWith('spec.md')).length
  } catch {
    return 0
  }
}

export function summarizeSdd(root: string): SddSummary {
  const out: SddSummary = {}
  const os = path.join(root, 'openspec')
  if (fs.existsSync(os)) {
    const rel = (...p: string[]) => toPosix(path.join('openspec', ...p))
    out.openspec = {
      changes: dirs(path.join(os, 'changes'))
        .filter((id) => id !== 'archive')
        .map((id) => {
          const dir = path.join(os, 'changes', id)
          const proposal = read(path.join(dir, 'proposal.md'))
          const tasks = read(path.join(dir, 'tasks.md'))
          return {
            id,
            // "Proposal: Add login" → "Add login"
            title: heading(proposal)?.replace(/^(change\s+)?proposal:\s*/i, '') ?? id,
            path: rel('changes', id, proposal !== null ? 'proposal.md' : 'tasks.md'),
            artifacts: { proposal: proposal !== null, design: fs.existsSync(path.join(dir, 'design.md')), tasks: tasks !== null, specs: countSpecs(path.join(dir, 'specs')) },
            tasks: progress(tasks),
          }
        }),
      specs: dirs(path.join(os, 'specs'))
        .filter((id) => fs.existsSync(path.join(os, 'specs', id, 'spec.md')))
        .map((id) => ({ id, path: rel('specs', id, 'spec.md') })),
      archived: dirs(path.join(os, 'changes', 'archive'))
        .reverse()
        .slice(0, 12)
        .map((id) => {
          const file = ['proposal.md', 'tasks.md'].find((f) => fs.existsSync(path.join(os, 'changes', 'archive', id, f)))
          return { id, path: file ? rel('changes', 'archive', id, file) : '' }
        }),
    }
  }
  if (fs.existsSync(path.join(root, '.specify'))) {
    const constitution = read(path.join(root, '.specify', 'memory', 'constitution.md'))
    out.speckit = {
      // The template is full of [PLACEHOLDERS] until /speckit-constitution fills it.
      constitution: constitution === null ? null : { path: '.specify/memory/constitution.md', filled: !/\[[A-Z_0-9]+\]/.test(constitution) },
      features: dirs(path.join(root, 'specs')).map((id) => {
        const dir = path.join(root, 'specs', id)
        const spec = read(path.join(dir, 'spec.md'))
        const tasks = read(path.join(dir, 'tasks.md'))
        return {
          id,
          // "Feature Specification: Login" → "Login"
          title: heading(spec)?.replace(/^feature specification:\s*/i, '') ?? id,
          path: toPosix(path.join('specs', id, spec !== null ? 'spec.md' : 'plan.md')),
          artifacts: { spec: spec !== null, plan: fs.existsSync(path.join(dir, 'plan.md')), tasks: tasks !== null },
          tasks: progress(tasks),
        }
      }),
    }
  }
  return out
}

/** Folders shown in the SDD sections, left out of the generic document list. */
export function sddPrefixes(summary: SddSummary): string[] {
  return [...(summary.openspec ? ['openspec/'] : []), ...(summary.speckit ? ['specs/', '.specify/'] : [])]
}
