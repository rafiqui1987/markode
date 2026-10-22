import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { mainDocOf, readConfig, TEMPLATES_DIR, writeConfig } from './config.js'
import { fill } from './scaffold.js'
import { writeManagedBlock } from './sdd.js'

/**
 * Proposals and comments: the AI writes choices as a doc (diagrams, options to tick) and the user
 * answers in markode, commenting like in Word. Active when the project has the proposals skill, so
 * the whole team (and their agents) share the setting through git.
 */
export type ProposalLayout = 'general' | 'structured'

const SKILL = path.join('.claude', 'skills', 'markode-proposals')

export function proposalsState(root: string): { active: boolean; layout: ProposalLayout } {
  return { active: fs.existsSync(path.join(root, SKILL, 'SKILL.md')), layout: readConfig(root)?.proposals ?? 'general' }
}

const WHERE: Record<ProposalLayout, string> = {
  general: '`docs/proposals/NNN-short-name.md` (NNN: the next number in that folder)',
  structured:
    '`docs/proposals/<topic>/NNN-short-name.md`, one folder per topic (e.g. `sidebar`, `auth`); in a monorepo, a proposal for a single project goes in `<project>/docs/proposals/<topic>/` (e.g. `apps/web/docs/proposals/auth/`). Reuse an existing topic folder; ask the user before creating a new one',
}

function section(layout: ProposalLayout) {
  return [
    '## Proposals',
    '',
    'When an answer would be long, has options or a design to validate, or the user asks for one, write a',
    'temporary proposal the user answers in markode instead of a chat answer (skill: `markode-proposals`).',
    '',
    `- Where: ${WHERE[layout]}.`,
    '- After writing one, run `markode wait <path>` in the background: it returns when the user answers in markode.',
    '- The user ticks options and comments (`<!-- comment by … -->`). When it is answered, reply to the comments,',
    '  update every doc that depends on the decision (tasks, phases, architecture…), then delete the proposal.',
  ].join('\n')
}

/** The project's main docs: the root one and those of its areas or subprojects. */
function mainDocs(root: string, mainDoc: string | null): string[] {
  const doc = mainDoc ?? mainDocOf(root)
  return doc ? [path.join(root, doc)] : []
}

export function activateProposals(root: string, layout: ProposalLayout, mainDoc: string | null) {
  const dir = path.join(root, SKILL)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), fill(fs.readFileSync(path.join(TEMPLATES_DIR, 'proposals', 'SKILL.md'), 'utf8'), { where: WHERE[layout] }))
  fs.mkdirSync(path.join(root, 'docs', 'proposals'), { recursive: true })
  for (const file of mainDocs(root, mainDoc)) writeManagedBlock(file, section(layout), false, 'proposals')
  writeConfig(root, { ...(readConfig(root) ?? { mainDoc, langs: [] }), proposals: layout })
}

/** Remove the skill and the main doc section; existing proposals and comments stay as they are. */
export function deactivateProposals(root: string, mainDoc: string | null) {
  fs.rmSync(path.join(root, SKILL), { recursive: true, force: true })
  for (const file of mainDocs(root, mainDoc)) writeManagedBlock(file, null, false, 'proposals')
}

/** Name used to sign comments: git's user.name for this project, if any. */
export function authorName(root: string): string | null {
  try {
    return execFileSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}
