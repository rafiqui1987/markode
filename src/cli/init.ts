import fs from 'node:fs'
import path from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { contentDoc, isPointer, type Lang, LANG_NAMES, LANGS, linkAgentsDoc, MAIN_DOCS, type ProjectConfig, readConfig, writeConfig } from '../core/config.js'
import { BASE_DEFAULTS, defaultsFile, readDefaults, type SetupDefaults, writeDefaults } from '../core/defaults.js'
import { appliedRuleIds, applyRulesToFile, listRules, sourceLangOf } from '../core/rules.js'
import { type Area, detectAreas, installMethodSkills, methodSection, scaffoldMethod, suggestPrefix } from '../core/method.js'
import { detectProfile, EXPERIMENTS_LABEL, type Experiments, existingDocs, findContracts, guessKind, KIND_HINT, KIND_LABEL, looksLikeMicroservices, type Profile, type ProjectKind } from '../core/profile.js'
import { activateProposals, type ProposalLayout } from '../core/proposals.js'
import { createMainDoc, ensureGitignore, hideInVsCode, installSkill } from '../core/scaffold.js'
import { applyWorkflowToFile, detectWorkflow, hasUv, installWorkflow, SDD_AGENTS, type SddAgent, type Workflow } from '../core/sdd.js'
import { findSubprojects, flattenFiles, scanTree } from '../core/scan.js'

function check<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }
  return value as Exclude<T, symbol>
}

/** Claude Code reads CLAUDE.md, not AGENTS.md: with only AGENTS.md, offer a CLAUDE.md that imports it. */
async function offerClaudeLink(root: string, d: SetupDefaults | null) {
  if (fs.existsSync(path.join(root, 'CLAUDE.md'))) return
  const link = d ? d.mainDoc === 'CLAUDE.md' : check(await p.confirm({ message: 'Claude Code reads CLAUDE.md, not AGENTS.md. Add a CLAUDE.md that imports AGENTS.md?', initialValue: true }))
  if (link && linkAgentsDoc(root)) p.log.success('Created CLAUDE.md (imports AGENTS.md)')
}

async function chooseMainDoc(root: string, d: SetupDefaults | null): Promise<string> {
  // A CLAUDE.md that only imports AGENTS.md is not a main doc of its own.
  const existing = MAIN_DOCS.filter((d) => fs.existsSync(path.join(root, d)) && !(d === 'CLAUDE.md' && isPointer(fs.readFileSync(path.join(root, d), 'utf8'))))
  if (d) {
    if (existing.length === 1 && existing[0] === 'AGENTS.md') await offerClaudeLink(root, d)
    if (existing.length) return existing.includes(d.mainDoc) ? d.mainDoc : existing[0]
    createMainDoc(root, d.mainDoc)
    p.log.success(`Created ${d.mainDoc}`)
    return d.mainDoc
  }

  if (existing.length === 2) {
    return check(
      await p.select({
        message: 'Both CLAUDE.md and AGENTS.md exist. Which one is the main document?',
        options: existing.map((d) => ({ value: d, label: d })),
      }),
    )
  }
  if (existing.length === 1) {
    const choice = check(
      await p.select({
        message: `Found ${pc.cyan(existing[0])}. Use it as the main document?`,
        options: [
          { value: existing[0], label: `Yes, use ${existing[0]}` },
          ...MAIN_DOCS.filter((d) => d !== existing[0]).map((d) => ({ value: d, label: `No, create ${d}` })),
        ],
      }),
    )
    createMainDoc(root, choice)
    if (choice === 'AGENTS.md') await offerClaudeLink(root, d)
    return choice
  }
  const choice = check(
    await p.select({
      message: 'No CLAUDE.md or AGENTS.md found. Which one should I create?',
      options: MAIN_DOCS.map((d) => ({ value: d, label: d, hint: d === 'CLAUDE.md' ? 'Claude Code' : 'other agents' })),
    }),
  )
  createMainDoc(root, choice)
  p.log.success(`Created ${choice}`)
  return choice
}

const WORKFLOW_OPTIONS: { value: Workflow; label: string; hint?: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'markode', label: 'markode method', hint: 'one file per task; vision, architecture and phases as they are needed; per project in monorepos' },
  { value: 'openspec', label: 'OpenSpec', hint: 'specs + proposed changes, good for existing projects' },
  { value: 'speckit', label: 'GitHub Spec Kit', hint: 'constitution → spec → plan → tasks, per feature' },
]
const PROPOSALS_QUESTION = 'The AI can write proposals you answer by ticking options and commenting. How should they be organized?'
const PROPOSAL_OPTIONS: { value: ProposalLayout; label: string; hint: string }[] = [
  { value: 'structured', label: 'By topic and area', hint: 'docs/proposals/auth/…, services/docs/proposals/…' },
  { value: 'general', label: 'One folder', hint: 'docs/proposals/' },
]
const MONOREPO_QUESTION = 'How should the docs of a monorepo be organized?'
const MONOREPO_OPTIONS: { value: SetupDefaults['monorepo']; label: string; hint: string }[] = [
  { value: 'per-project', label: 'One set per project', hint: 'each project: its CLAUDE.md/AGENTS.md, architecture, tasks and proposals; the root main doc is the overview' },
  { value: 'single', label: 'One docs/ for everything', hint: 'at the root' },
]
const SOURCE_LANG_QUESTION = 'Language you work in (every .md file is written in it)'
const SOURCE_LANG_MARK = /<!-- markode:source-lang:\w+ -->/
const LANG_OPTIONS = LANGS.map((l) => ({ value: l, label: LANG_NAMES[l], hint: l === 'en' ? 'default' : undefined }))
const HIDE_QUESTION = 'Hide the .markode/ folder in VS Code?'
const ruleOptions = (rules: ReturnType<typeof listRules>) => rules.map((r) => ({ value: r.id, label: r.title, hint: r.body.split('\n')[0].replace(/^- /, '') }))
/** Working rules: none by default (start from scratch), or picked from the user's library. */
async function chooseRules(message: string, rules: ReturnType<typeof listRules>, initial: string[]): Promise<string[]> {
  const pick = check(
    await p.select({
      message,
      options: [
        { value: 'none', label: 'None', hint: 'start from scratch; add your own later in the Rules tab' },
        { value: 'pick', label: 'Choose rules', hint: 'common rules for AI agents, plus the ones you create' },
      ],
      initialValue: initial.length ? 'pick' : 'none',
    }),
  )
  if (pick === 'none') return []
  return check(await p.multiselect({ message: 'Which rules?', options: ruleOptions(rules), initialValues: initial, required: false }))
}
const agentOptions = () => (Object.keys(SDD_AGENTS) as SddAgent[]).map((a) => ({ value: a, label: SDD_AGENTS[a].label }))

const WORKFLOW_LABEL: Record<Workflow, string> = { none: 'None', markode: 'markode', openspec: 'OpenSpec', speckit: 'GitHub Spec Kit' }
const WORKFLOW_GUIDE: Record<Workflow, string> = { none: '', markode: '.claude/skills/markode-method/SKILL.md', openspec: 'openspec/README.md', speckit: 'specs/README.md' }

/** Questions about what can't be detected are asked even with saved defaults, when there is a terminal. */
const canAsk = () => !!process.stdin.isTTY

/** In a monorepo, which projects get their own docs and tasks, and their task prefixes. */
async function chooseAreas(root: string, d: SetupDefaults | null): Promise<Area[]> {
  const { dirs: candidates, unsure } = detectAreas(root)
  if (!candidates.length) return []
  if (unsure && canAsk()) {
    const separate = check(
      await p.confirm({
        message: `${candidates.map((c) => `${c}/`).join(', ')} each have their own manifest. Are they separate projects (e.g. a front end and a back end)?`,
        initialValue: true,
      }),
    )
    if (!separate) return []
  }
  if (d) {
    const used = new Set<string>()
    return d.monorepo === 'single' ? [] : candidates.map((dir) => ({ dir, prefix: suggestPrefix(dir, used) }))
  }
  p.log.info(`Monorepo detected: ${candidates.map((c) => `${c}/`).join(', ')}`)
  const layout = check(await p.select<SetupDefaults['monorepo']>({ message: MONOREPO_QUESTION, options: MONOREPO_OPTIONS }))
  if (layout === 'single') return []
  const dirs = check(
    await p.multiselect({
      message: 'Which projects get their own docs?',
      options: candidates.map((d) => ({ value: d, label: `${d}/` })),
      initialValues: candidates,
      required: false,
    }),
  )
  const used = new Set<string>()
  const areas = dirs.map((dir) => ({ dir, prefix: suggestPrefix(dir, used) }))
  if (!areas.length) return areas
  const ok = check(await p.confirm({ message: `Task prefixes: ${areas.map((a) => `${a.dir} → ${a.prefix}`).join(', ')}, across projects → CORE. Use them?`, initialValue: true }))
  if (ok) return areas
  for (const a of areas) {
    a.prefix = check(
      await p.text({
        message: `Task prefix for ${a.dir}/`,
        initialValue: a.prefix,
        validate: (v) => (/^[A-Z][A-Z0-9]{0,5}$/.test(v ?? '') && v !== 'CORE' && !areas.some((o) => o !== a && o.prefix === v) ? undefined : 'Uppercase letters and digits, unique, not CORE'),
      }),
    )
  }
  return areas
}

/** What kind of project `dir` is: detected, or asked when the files don't make it clear. */
async function chooseKind(root: string, dir: string): Promise<ProjectKind> {
  const guess = guessKind(path.join(root, dir))
  if (!guess.unclear || !canAsk()) return guess.kind
  const where = dir ? `${dir}/` : 'this project'
  const seen = guess.signals.length ? `found: ${guess.signals.join(', ')}` : 'no code yet'
  return check(
    await p.select<ProjectKind>({
      message: `What kind of project is ${where}? (${seen})`,
      options: (Object.keys(KIND_LABEL) as ProjectKind[]).map((k) => ({ value: k, label: KIND_LABEL[k], hint: KIND_HINT[k] })),
      initialValue: guess.kind,
    }),
  )
}

/** The answers a kind needs; with saved defaults, what the folder already shows. */
async function askProfile(root: string, dir: string, kind: ProjectKind, d: SetupDefaults | null): Promise<Profile> {
  const base = detectProfile(path.join(root, dir), kind)
  if (d || kind === 'app') return base
  const where = dir ? ` (${dir}/)` : ''
  if (kind === 'library') return { kind, published: check(await p.confirm({ message: `Is the library${where} published (npm, PyPI…)?`, initialValue: base.published })) }
  if (kind === 'mobile') {
    const platforms = check(
      await p.multiselect({
        message: `Target platforms${where}`,
        options: ['ios', 'android', 'web'].map((v) => ({ value: v, label: v === 'ios' ? 'iOS' : v === 'android' ? 'Android' : 'Web' })),
        initialValues: base.platforms,
        required: false,
      }),
    )
    return { kind, platforms }
  }
  if (kind === 'data') {
    const dataLocation = check(await p.text({ message: `Where does the data live${where}? (folder, bucket, database; empty if not decided)`, initialValue: base.dataLocation, defaultValue: '' }))
    const experiments = check(
      await p.select<Experiments>({
        message: 'How are experiments tracked?',
        options: (Object.keys(EXPERIMENTS_LABEL) as Experiments[]).map((v) => ({ value: v, label: EXPERIMENTS_LABEL[v].replace(/`/g, '') })),
        initialValue: base.experiments,
      }),
    )
    return { kind, dataLocation: dataLocation.trim(), experiments }
  }
  const environments = check(await p.text({ message: `Environments${where}`, initialValue: base.environments, defaultValue: base.environments }))
  return { kind, environments: environments.trim() }
}

/** Where a repository of services keeps its contracts; null when it doesn't look like one. */
async function chooseContracts(root: string, areas: Area[], d: SetupDefaults | null): Promise<string | null> {
  if (!looksLikeMicroservices(root, areas.length)) return null
  const found = findContracts(root)
  if ((d && found) || !canAsk()) return found
  const answer = check(
    await p.text({
      message: 'Several services: where do their contracts (APIs, events) live? (e.g. proto/, an OpenAPI file; empty if none)',
      initialValue: found ?? '',
      defaultValue: '',
    }),
  )
  return answer.trim() || null
}

/** Docs the project already had: which ones are official (with saved defaults, all of them). */
async function chooseExisting(root: string, d: SetupDefaults | null): Promise<string[]> {
  const found = existingDocs(root)
  if (!found.length || d) return found
  return check(
    await p.multiselect({
      message: 'These docs already exist. Which are the official ones? (the agent updates them instead of creating new ones)',
      options: found.map((f) => ({ value: f, label: f })),
      initialValues: found,
      required: false,
    }),
  )
}

/** Ask for the specs and planning structure and create it; an existing OpenSpec or Spec Kit setup is kept as is. */
async function chooseWorkflow(root: string, mainDoc: string, previous: Workflow | undefined, d: SetupDefaults | null): Promise<{ workflow: Workflow; section?: string }> {
  const detected = detectWorkflow(root)
  if (detected) {
    p.log.info(`${WORKFLOW_LABEL[detected]} found: markode shows it in the dashboard.`)
    return { workflow: detected }
  }
  for (;;) {
    const choice = d ? d.workflow : check(await p.select<Workflow>({ message: 'Create a base structure for specs and planning?', options: WORKFLOW_OPTIONS, initialValue: previous ?? 'none' }))
    if (choice === 'none') return { workflow: choice }
    if (choice === 'markode') {
      const existing = await chooseExisting(root, d)
      const areas = await chooseAreas(root, d)
      for (const a of areas) a.profile = await askProfile(root, a.dir, await chooseKind(root, a.dir), d)
      const contracts = await chooseContracts(root, areas, d)
      const profile = areas.length ? undefined : await askProfile(root, '', await chooseKind(root, ''), d)
      const created = scaffoldMethod(root, mainDoc, areas)
      installMethodSkills(root)
      // Proposals come with the method: per project and topic in a monorepo; a big single project may
      // still want them by topic.
      const big = !areas.length && flattenFiles(scanTree(root)).length > 40
      const layout: ProposalLayout = areas.length ? 'structured' : !big || d ? 'general' : check(await p.select<ProposalLayout>({ message: PROPOSALS_QUESTION, options: PROPOSAL_OPTIONS }))
      activateProposals(root, layout, mainDoc)
      if (created.length) p.log.success(`Created ${created.length} files: ${created.slice(0, 8).join(', ')}${created.length > 8 ? '…' : ''}`)
      p.log.info(`Docs grow when there is something to write. Skills: /markode-status, /markode-new-task, /markode-close-session.`)
      return { workflow: choice, section: methodSection(areas, root, { profile, contracts, existing }) }
    }

    let official = true
    if (choice === 'speckit' && !hasUv() && d) {
      p.log.warn('Spec Kit needs uv (Python) to install its AI commands, and uv was not found: creating the structure only.')
      official = false
    } else if (choice === 'speckit' && !hasUv()) {
      const next = check(
        await p.select({
          message: 'Spec Kit needs uv (Python) to install its AI commands, and uv was not found.',
          options: [
            { value: 'back', label: 'Choose another option' },
            { value: 'skeleton', label: 'Create the structure only', hint: 'the guide explains how to install Spec Kit later' },
          ],
        }),
      )
      if (next === 'back') continue
      official = false
    }

    const initial: SddAgent = mainDoc === 'AGENTS.md' ? 'codex' : 'claude'
    // Spec Kit sets up one agent at init; OpenSpec any number.
    const agents: SddAgent[] = !official
      ? [initial]
      : d
        ? choice === 'speckit'
          ? [d.agents[0] ?? initial]
          : d.agents
        : choice === 'openspec'
        ? check(await p.multiselect({ message: 'Install the OpenSpec commands for which agents?', options: agentOptions(), initialValues: [initial], required: false }))
        : [check(await p.select({ message: 'Install the Spec Kit commands for which agent?', options: agentOptions(), initialValue: initial }))]

    const spin = p.spinner()
    spin.start(official ? `Installing ${WORKFLOW_LABEL[choice]}…` : 'Creating the structure…')
    const res = installWorkflow(root, choice, agents, official)
    spin.stop(res.official ? `${WORKFLOW_LABEL[choice]} installed` : 'Structure created')
    if (official && !res.official) p.log.warn(`Couldn't run the ${WORKFLOW_LABEL[choice]} installer:\n${pc.dim(res.error ?? '')}\nCreated the structure only.`)
    if (!res.official) p.log.info(`To add the AI commands later, see ${pc.cyan(WORKFLOW_GUIDE[choice])}.`)
    if (res.ignored.length) p.log.info(`Agent commands hidden in markode (${res.ignored.length} folders); the eye button in the sidebar shows them.`)
    return { workflow: choice }
  }
}

/** Set up the project: with the user's saved defaults `d`, or asking every question when null. */
export async function runInit(root: string, d: SetupDefaults | null = null): Promise<ProjectConfig> {
  p.intro(pc.bgCyan(pc.black(' markode ')))
  if (d) p.log.info(`Using your defaults (${pc.cyan(defaultsFile())}). To choose differently for this project: ${pc.cyan('markode init --custom')}`)
  const previous = readConfig(root)

  const mainDoc = await chooseMainDoc(root, d)
  const mainFile = path.join(root, mainDoc)

  const { workflow, section } = await chooseWorkflow(root, mainDoc, previous?.workflow, d)
  applyWorkflowToFile(mainFile, workflow, section)

  const mainText = fs.readFileSync(mainFile, 'utf8')
  // A language the project already declares is the team's: defaults don't override it.
  const sourceLang = d
    ? SOURCE_LANG_MARK.test(mainText)
      ? sourceLangOf(mainText)
      : d.sourceLang
    : check(await p.select<Lang>({ message: SOURCE_LANG_QUESTION, options: LANG_OPTIONS, initialValue: sourceLangOf(mainText) }))

  // Translations to review the docs in are added on purpose, with `markode translate`.
  const langs = (previous?.langs ?? []).filter((l) => l !== sourceLang)

  const rules = listRules()
  const applied = appliedRuleIds(mainText)
  // Defaults add rules; they never remove the ones the project already has.
  const selected = d
    ? [...new Set([...applied, ...d.rules.filter((id) => rules.some((r) => r.id === id))])]
    : await chooseRules('Working rules for this project', rules, applied)
  applyRulesToFile(mainFile, selected, sourceLang)

  const subprojects = findSubprojects(scanTree(root))
  if (subprojects.length && selected.length) {
    const targets = d
      ? d.rulesInSubprojects
        ? subprojects
        : []
      : check(
      await p.multiselect({
        message: 'Monorepo detected. Apply the same rules to these projects too?',
        options: subprojects.map((s) => ({ value: s, label: s })),
        required: false,
      }),
    )
    for (const dir of targets) {
      applyRulesToFile(contentDoc(path.join(root, dir))!, selected, sourceLang)
    }
  }

  ensureGitignore(root)
  if (!previous) {
    const hide = d ? d.hideInVsCode : check(await p.confirm({ message: HIDE_QUESTION, initialValue: true }))
    if (hide && !hideInVsCode(root)) p.log.warn('.vscode/settings.json has comments; add "**/.markode": true to files.exclude by hand.')
  }
  installSkill(root)

  const config: ProjectConfig = { mainDoc, langs, langNames: previous?.langNames, workflow, proposals: readConfig(root)?.proposals, initializedAt: previous?.initializedAt ?? new Date().toISOString() }
  writeConfig(root, config)
  p.outro(`Ready. Skill installed in ${pc.cyan('.claude/skills/markode')}. To review the docs in another language: ${pc.cyan('markode translate')}`)
  return config
}

/**
 * Choose how new projects are set up, once per user: with answers given now (applied to every
 * project without asking) or asking in each project. `quick` picks the latter without questions.
 */
export async function runSetup(quick = false): Promise<SetupDefaults> {
  const previous = readDefaults() ?? BASE_DEFAULTS
  if (quick) {
    const d = { ...previous, mode: 'ask' as const }
    writeDefaults(d)
    return d
  }
  p.intro(pc.bgCyan(pc.black(' markode setup ')))
  const mode = check(
    await p.select<SetupDefaults['mode']>({
      message: 'How should markode set up your projects?',
      options: [
        { value: 'defaults', label: 'With my answers', hint: 'asked now, once; every project uses them' },
        { value: 'ask', label: 'Ask in each project' },
      ],
      initialValue: previous.mode === 'ask' && !readDefaults() ? 'defaults' : previous.mode,
    }),
  )
  if (mode === 'ask') {
    const d = { ...previous, mode }
    writeDefaults(d)
    p.outro(`Saved. Each project will ask its own questions. Change it with ${pc.cyan('markode setup')}`)
    return d
  }

  const mainDoc = check(
    await p.select({
      message: 'Main document to create when a project has none',
      options: MAIN_DOCS.map((d) => ({ value: d, label: d, hint: d === 'CLAUDE.md' ? 'Claude Code' : 'other agents' })),
      initialValue: previous.mainDoc,
    }),
  )
  const workflow = check(await p.select<Workflow>({ message: 'Base structure for specs and planning', options: WORKFLOW_OPTIONS, initialValue: previous.workflow }))
  let agents = previous.agents
  let monorepo = previous.monorepo
  if (workflow === 'openspec')
    agents = check(await p.multiselect({ message: 'Install the OpenSpec commands for which agents?', options: agentOptions(), initialValues: previous.agents, required: false }))
  if (workflow === 'speckit') agents = [check(await p.select({ message: 'Install the Spec Kit commands for which agent?', options: agentOptions(), initialValue: previous.agents[0] }))]
  if (workflow === 'markode') monorepo = check(await p.select<SetupDefaults['monorepo']>({ message: MONOREPO_QUESTION, options: MONOREPO_OPTIONS, initialValue: previous.monorepo }))
  const sourceLang = check(await p.select<Lang>({ message: `${SOURCE_LANG_QUESTION}; projects that already declare one keep it`, options: LANG_OPTIONS, initialValue: previous.sourceLang }))
  const rules = listRules()
  const selected = await chooseRules('Working rules for your projects', rules, previous.rules.filter((id) => rules.some((r) => r.id === id)))
  const rulesInSubprojects = selected.length ? check(await p.confirm({ message: 'In monorepos, apply the rules to the subprojects too?', initialValue: previous.rulesInSubprojects })) : false
  const hideInVsCode = check(await p.confirm({ message: HIDE_QUESTION, initialValue: previous.hideInVsCode }))

  const d: SetupDefaults = { mode, mainDoc, workflow, agents, monorepo, sourceLang, rules: selected, rulesInSubprojects, hideInVsCode }
  writeDefaults(d)
  p.outro(`Saved in ${pc.cyan(defaultsFile())}. Change them with ${pc.cyan('markode setup')}; for a single project: ${pc.cyan('markode init --custom')}`)
  return d
}
