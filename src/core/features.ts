import fs from 'node:fs'
import path from 'node:path'
import { assertInside, contentDoc, type Lang, MAIN_DOCS, mainDocOf, type ProjectConfig, readConfig, stateDir, TEMPLATES_DIR, writeConfig } from './config.js'
import { hasClaudeHooks, installClaudeHooks, removeClaudeHooks } from './hooks.js'
import { detectLang } from './langdetect.js'
import { installMethodSkills, setupMethod } from './method.js'
import { activateProposals, deactivateProposals, proposalsState } from './proposals.js'
import { appliedRuleIds, applyRulesToFile, sourceLangOf } from './rules.js'
import { createMainDoc, hideInVsCode, isHiddenInVsCode, showInVsCode } from './scaffold.js'
import { findSubprojects, flattenFiles, scanTree } from './scan.js'
import { detectWorkflow, writeManagedBlock } from './sdd.js'
import { PROJECT_TARGETS, projectTargets } from './skills.js'

/**
 * What markode can add to a project besides the viewer, which is always there. Each module is turned on
 * by `markode init` (through a profile) and on or off later in Settings; turning one off removes only the
 * pieces markode manages (its blocks, skills and hooks), never the user's docs, tasks or proposals.
 */
export type Feature = 'agent' | 'rules' | 'proposals' | 'live' | 'translations' | 'dashboard' | 'skills' | 'vscode'
export const FEATURES: Feature[] = ['agent', 'rules', 'proposals', 'live', 'translations', 'dashboard', 'skills', 'vscode']

/** Modules that only make sense with the AI agent: on turns it on, and turning it off turns them off. */
export const REQUIRES: Partial<Record<Feature, Feature>> = { rules: 'agent', proposals: 'agent', live: 'agent', translations: 'agent' }

/** Name and what each module does, for the terminal (the web UI has its own translated texts). */
export const FEATURE_INFO: Record<Feature, { label: string; hint: string }> = {
  agent: { label: 'AI agent', hint: 'teaches your agent (Claude Code, Codex, Cursor…) to work with markode docs; you can comment on any text for it' },
  rules: { label: 'Working rules', hint: 'rules the agent follows (ask before committing, protect secrets…), chosen in the Rules tab and written in CLAUDE.md/AGENTS.md' },
  proposals: { label: 'Proposals', hint: 'the agent answers big questions with a doc you answer by ticking options and commenting' },
  live: { label: 'Live changes', hint: 'Claude Code hears about your edits and comments while it works (personal hooks in .claude/settings.local.json)' },
  translations: { label: 'Translations', hint: 'read and edit the docs in other languages; the agent translates them' },
  dashboard: { label: 'Dashboard and tasks', hint: 'a panel with the state of docs, phases and tasks; with the AI agent it also creates the task structure' },
  skills: { label: 'Skills', hint: 'a tab to browse, edit and add to the project the skills installed for your agents' },
  vscode: { label: 'Hide in VS Code', hint: 'hides markode\'s .markode/ folder (translations, state) from the VS Code explorer' },
}

/** Ready-made sets of modules, so setting a project up is one question (or none, with saved defaults). */
export type InstallProfile = 'viewer' | 'agent' | 'full'
const AGENT_SET: Feature[] = ['agent', 'rules', 'proposals', 'live', 'translations', 'skills', 'vscode']
export const PROFILE_FEATURES: Record<InstallProfile, Feature[]> = {
  viewer: [],
  agent: AGENT_SET,
  full: [...AGENT_SET, 'dashboard'],
}
export const PROFILE_INFO: Record<InstallProfile, { label: string; hint: string }> = {
  viewer: { label: 'Viewer only', hint: 'see and edit the .md files; nothing is written to the project' },
  agent: { label: 'Viewer + AI agent', hint: 'adds the agent skill, rules, proposals, comments, live changes and translations' },
  full: { label: 'Complete', hint: 'all of the above plus the dashboard and a docs structure for vision, phases and tasks' },
}
export const isProfile = (v: unknown): v is InstallProfile => typeof v === 'string' && v in PROFILE_FEATURES
export const isFeature = (v: unknown): v is Feature => FEATURES.includes(v as Feature)

/** With everything a module needs, in the order to turn them on. */
export function withRequired(list: Feature[]): Feature[] {
  const out = new Set<Feature>()
  for (const f of list) {
    const need = REQUIRES[f]
    if (need) out.add(need)
    out.add(f)
  }
  return FEATURES.filter((f) => out.has(f))
}

/** Modules that are only a part of markode's interface: a personal choice kept in .markode/config.json. */
const UI_ONLY: Feature[] = ['rules', 'translations', 'dashboard', 'skills']
type Flags = NonNullable<ProjectConfig['features']>

const SKILL = 'markode'
const skillDirs = (root: string) => Object.values(PROJECT_TARGETS).map((t) => path.join(root, t, SKILL))
const hasAgentSkill = (root: string) => skillDirs(root).some((d) => fs.existsSync(path.join(d, 'SKILL.md')))

/** Which modules are on. Projects set up before modules existed keep every part of the interface. */
export function featureState(root: string): Record<Feature, boolean> {
  const flags = readConfig(root)?.features ?? {}
  const agent = hasAgentSkill(root)
  return {
    agent,
    rules: agent && flags.rules !== false,
    proposals: agent && proposalsState(root).active,
    live: agent && hasClaudeHooks(root),
    translations: agent && flags.translations !== false,
    dashboard: flags.dashboard !== false,
    skills: flags.skills !== false,
    vscode: isHiddenInVsCode(root),
  }
}

function setFlags(root: string, patch: Partial<Flags & Pick<ProjectConfig, 'savedRules'>>) {
  const c = readConfig(root) ?? { mainDoc: mainDocOf(root), langs: [] }
  const { savedRules, ...flags } = patch
  writeConfig(root, { ...c, features: { ...c.features, ...flags }, ...('savedRules' in patch ? { savedRules } : {}) })
}

/** The language most of the project's docs are written in; `fallback` when there is no prose to tell. */
export function detectSourceLang(root: string, fallback: Lang): Lang {
  const votes = new Map<Lang, number>()
  for (const f of flattenFiles(scanTree(root)).slice(0, 200)) {
    try {
      const lang = detectLang(fs.readFileSync(path.join(root, f.path), 'utf8'))
      if (lang) votes.set(lang, (votes.get(lang) ?? 0) + 1)
    } catch {}
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback
}

/** The project's main doc: the one it has, or a new one for the agents it uses. */
export function ensureMainDoc(root: string, preferred?: (typeof MAIN_DOCS)[number]): string {
  const existing = mainDocOf(root)
  if (existing) return existing
  const doc = preferred ?? (projectTargets(root).includes('claude') ? 'CLAUDE.md' : 'AGENTS.md')
  createMainDoc(root, doc)
  return doc
}

/** Install (or refresh) the agent skill where the project's agents read skills: Claude Code and/or `.agents/`. */
export function installAgentSkill(root: string) {
  const src = path.join(TEMPLATES_DIR, 'skill', 'SKILL.md')
  for (const target of projectTargets(root)) {
    const dir = path.join(root, PROJECT_TARGETS[target], SKILL)
    fs.mkdirSync(dir, { recursive: true })
    const dest = path.join(dir, 'SKILL.md')
    assertInside(dest)
    const text = fs.readFileSync(src, 'utf8')
    if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== text) fs.writeFileSync(dest, text)
  }
}

/** Main docs of the root and every subproject: where markode's blocks may live. */
function allMainDocs(root: string): string[] {
  return ['', ...findSubprojects(scanTree(root))].map((d) => contentDoc(path.join(root, d))).filter((f): f is string => !!f)
}

const METHOD_SKILLS = () => fs.readdirSync(path.join(TEMPLATES_DIR, 'method', 'skills'))

export interface FeatureOptions {
  /** Main doc to create when the project has none. */
  mainDoc?: (typeof MAIN_DOCS)[number]
  /** Source language when neither the main doc nor the project's docs show one. */
  sourceLang?: Lang
  /** Rules to write when the rules module is turned on and the doc has none. */
  rules?: string[]
  /** Layout of a monorepo's docs, for the dashboard's task structure. */
  monorepo?: 'per-project' | 'single'
}

/**
 * Turn one module on or off, with the modules it needs or that need it. Returns what changed, as
 * `feature → on/off`, for the caller to report.
 */
export function setFeature(root: string, feature: Feature, on: boolean, opts: FeatureOptions = {}): Partial<Record<Feature, boolean>> {
  const state = featureState(root)
  const changed: Partial<Record<Feature, boolean>> = {}
  if (on) {
    const need = REQUIRES[feature]
    if (need && !state[need]) Object.assign(changed, setFeature(root, need, true, opts))
  } else if (feature === 'agent') {
    for (const f of FEATURES) if (REQUIRES[f] === 'agent' && state[f]) Object.assign(changed, setFeature(root, f, false, opts))
  }
  if (state[feature] === on && !UI_ONLY.includes(feature)) return changed
  apply(root, feature, on, opts)
  changed[feature] = on
  return changed
}

function apply(root: string, feature: Feature, on: boolean, opts: FeatureOptions) {
  switch (feature) {
    case 'agent': {
      if (on) {
        // Before the main doc is created from markode's (English) template.
        const lang = readConfig(root)?.savedSourceLang ?? detectSourceLang(root, opts.sourceLang ?? 'en')
        const doc = path.join(root, ensureMainDoc(root, opts.mainDoc))
        installAgentSkill(root)
        // The working-rules block points the agent to the skill and declares the source language.
        const text = fs.readFileSync(doc, 'utf8')
        const declared = /<!-- markode:source-lang:\w+ -->/.test(text)
        applyRulesToFile(doc, appliedRuleIds(text), declared ? sourceLangOf(text) : lang)
      } else {
        // Remembered for when the agent is turned back on: markode's own docs would outvote the project's.
        const doc = mainDocOf(root)
        const c = readConfig(root)
        if (doc && c) writeConfig(root, { ...c, savedSourceLang: sourceLangOf(fs.readFileSync(path.join(root, doc), 'utf8')) })
        for (const d of skillDirs(root)) if (fs.existsSync(d)) assertInside(d), fs.rmSync(d, { recursive: true, force: true })
        for (const doc of allMainDocs(root)) writeManagedBlock(doc, null, false, 'rules')
      }
      return
    }
    case 'rules': {
      const doc = mainDocOf(root)
      const file = doc && path.join(root, doc)
      if (on) {
        const saved = readConfig(root)?.savedRules ?? []
        const current = file ? appliedRuleIds(fs.readFileSync(file, 'utf8')) : []
        const ids = current.length ? current : saved.length ? saved : (opts.rules ?? [])
        if (file && ids.length) applyRulesToFile(file, ids)
        setFlags(root, { rules: true, savedRules: undefined })
      } else {
        // Kept so turning rules back on restores the same ones.
        const ids = file ? appliedRuleIds(fs.readFileSync(file, 'utf8')) : []
        if (file) applyRulesToFile(file, [])
        setFlags(root, { rules: false, savedRules: ids.length ? ids : undefined })
      }
      return
    }
    case 'proposals':
      if (on) activateProposals(root, readConfig(root)?.proposals ?? (findSubprojects(scanTree(root)).length ? 'structured' : 'general'), mainDocOf(root))
      else deactivateProposals(root, mainDocOf(root))
      return
    case 'live':
      if (on) installClaudeHooks(root)
      else removeClaudeHooks(root)
      return
    case 'translations':
      setFlags(root, { translations: on })
      return
    case 'dashboard': {
      setFlags(root, { dashboard: on })
      // The task structure is for the agent; OpenSpec and Spec Kit are their own tools and stay as they are.
      if (on && hasAgentSkill(root) && !detectWorkflow(root) && (readConfig(root)?.workflow ?? 'none') === 'none') {
        const mainDoc = ensureMainDoc(root, opts.mainDoc)
        setupMethod(root, mainDoc, opts.monorepo ?? 'per-project')
        const c = readConfig(root)!
        writeConfig(root, { ...c, workflow: 'markode' })
      }
      if (!on && readConfig(root)?.workflow === 'markode') {
        for (const name of METHOD_SKILLS())
          for (const t of Object.values(PROJECT_TARGETS)) {
            const dir = path.join(root, t, name)
            if (fs.existsSync(dir)) assertInside(dir), fs.rmSync(dir, { recursive: true, force: true })
          }
        for (const doc of allMainDocs(root)) writeManagedBlock(doc, null, false, 'workflow')
        const c = readConfig(root)!
        writeConfig(root, { ...c, workflow: 'none' })
      }
      return
    }
    case 'skills':
      setFlags(root, { skills: on })
      return
    case 'vscode':
      if (on) hideInVsCode(root)
      else showInVsCode(root)
      return
  }
}

/**
 * Bring what markode installed up to this version: the agent skill, the proposals skill and section, and
 * the method skills. Run when the editor starts, so updating markode never needs another `markode init`.
 */
export function refreshInstalled(root: string) {
  if (!hasAgentSkill(root)) return
  installAgentSkill(root)
  const proposals = proposalsState(root)
  if (proposals.active) activateProposals(root, proposals.layout, mainDocOf(root))
  if (readConfig(root)?.workflow === 'markode') installMethodSkills(root)
}

/** Keep markode's own folder (config, translations, activity log) out of git without touching .gitignore. */
export function ignoreStateDir(root: string) {
  const file = path.join(stateDir(root), '.gitignore')
  if (fs.existsSync(file)) return
  assertInside(file)
  fs.mkdirSync(stateDir(root), { recursive: true })
  fs.writeFileSync(file, '# markode\'s personal state: never committed\n*\n')
}
