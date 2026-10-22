import fs from 'node:fs'
import path from 'node:path'
import { GLOBAL_DIR, isLang, type Lang, MAIN_DOCS } from './config.js'
import type { SddAgent, Workflow } from './sdd.js'

/**
 * How `markode` sets up a new project: with answers the user gave once (`markode setup`), or asking
 * in each project. Global, per user; a project can still be set up by hand with `init --custom`.
 */
export interface SetupDefaults {
  mode: 'defaults' | 'ask'
  /** Main doc created when a project has none, and preferred when it has both. */
  mainDoc: (typeof MAIN_DOCS)[number]
  workflow: Workflow
  /** Agents that get the OpenSpec or Spec Kit commands (Spec Kit uses the first one). */
  agents: SddAgent[]
  /**
   * In a monorepo: each project gets its own main doc and docs/ (architecture, tasks, proposals) and the
   * root main doc is the overview, or a single docs/ at the root holds everything.
   */
  monorepo: 'per-project' | 'single'
  /** Used when the project doesn't declare its source language yet. */
  sourceLang: Lang
  rules: string[]
  rulesInSubprojects: boolean
  hideInVsCode: boolean
}

export const BASE_DEFAULTS: SetupDefaults = {
  mode: 'ask',
  mainDoc: 'CLAUDE.md',
  workflow: 'none',
  agents: ['claude'],
  monorepo: 'per-project',
  sourceLang: 'en',
  rules: [],
  rulesInSubprojects: false,
  hideInVsCode: true,
}

export const defaultsFile = () => path.join(GLOBAL_DIR, 'defaults.json')

/** The saved defaults, or null if the user hasn't chosen how to set up projects yet. */
export function readDefaults(): SetupDefaults | null {
  try {
    const saved = { ...BASE_DEFAULTS, ...JSON.parse(fs.readFileSync(defaultsFile(), 'utf8')) } as SetupDefaults
    if (!isLang(saved.sourceLang)) saved.sourceLang = BASE_DEFAULTS.sourceLang
    if (!MAIN_DOCS.includes(saved.mainDoc)) saved.mainDoc = BASE_DEFAULTS.mainDoc
    if (saved.monorepo !== 'single') saved.monorepo = 'per-project'
    return saved
  } catch {
    return null
  }
}

export function writeDefaults(defaults: SetupDefaults) {
  fs.mkdirSync(GLOBAL_DIR, { recursive: true })
  fs.writeFileSync(defaultsFile(), JSON.stringify(defaults, null, 2) + '\n')
}
