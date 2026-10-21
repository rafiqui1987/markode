import fs from 'node:fs'
import path from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { type Lang, LANG_NAMES, LANGS, MAIN_DOCS, type ProjectConfig, readConfig, writeConfig } from '../core/config.js'
import { appliedRuleIds, applyRulesToFile, listRules, sourceLangOf } from '../core/rules.js'
import { type Area, detectAreas, installMethodSkills, methodSection, scaffoldMethod, suggestPrefix } from '../core/method.js'
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

async function chooseMainDoc(root: string): Promise<string> {
  const existing = MAIN_DOCS.filter((d) => fs.existsSync(path.join(root, d)))

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

const WORKFLOW_LABEL: Record<Workflow, string> = { none: 'None', mdrules: 'mdrules', openspec: 'OpenSpec', speckit: 'GitHub Spec Kit' }
const WORKFLOW_GUIDE: Record<Workflow, string> = { none: '', mdrules: 'docs/README.md', openspec: 'openspec/README.md', speckit: 'specs/README.md' }

/** In a monorepo, which top-level folders get their own docs and tasks, and their task prefixes. */
async function chooseAreas(root: string): Promise<Area[]> {
  const candidates = detectAreas(root)
  if (!candidates.length) return []
  const dirs = check(
    await p.multiselect({
      message: 'Monorepo detected. Which folders are areas with their own docs and tasks? (none: one docs/ for everything)',
      options: candidates.map((d) => ({ value: d, label: `${d}/` })),
      initialValues: candidates,
      required: false,
    }),
  )
  const used = new Set<string>()
  const areas = dirs.map((dir) => ({ dir, prefix: suggestPrefix(dir, used) }))
  if (!areas.length) return areas
  const ok = check(await p.confirm({ message: `Task prefixes: ${areas.map((a) => `${a.dir} → ${a.prefix}`).join(', ')}, cross-area → CORE. Use them?`, initialValue: true }))
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

/** Ask for the specs and planning structure and create it; an existing OpenSpec or Spec Kit setup is kept as is. */
async function chooseWorkflow(root: string, mainDoc: string, previous: Workflow | undefined): Promise<{ workflow: Workflow; section?: string }> {
  const detected = detectWorkflow(root)
  if (detected) {
    p.log.info(`${WORKFLOW_LABEL[detected]} found: mdrules shows it in the dashboard.`)
    return { workflow: detected }
  }
  for (;;) {
    const choice = check(
      await p.select<Workflow>({
        message: 'Create a base structure for specs and planning?',
        options: [
          { value: 'none', label: 'None' },
          { value: 'mdrules', label: 'mdrules method', hint: 'vision, architecture, phases and one file per task; per area in monorepos' },
          { value: 'openspec', label: 'OpenSpec', hint: 'specs + proposed changes, good for existing projects' },
          { value: 'speckit', label: 'GitHub Spec Kit', hint: 'constitution → spec → plan → tasks, per feature' },
        ],
        initialValue: previous ?? 'none',
      }),
    )
    if (choice === 'none') return { workflow: choice }
    if (choice === 'mdrules') {
      const areas = await chooseAreas(root)
      const created = scaffoldMethod(root, mainDoc, areas)
      installMethodSkills(root)
      // Proposals come with the method; how to organize them only matters in a big project.
      const big = areas.length > 0 || flattenFiles(scanTree(root)).length > 40
      const layout: ProposalLayout = big
        ? check(
            await p.select<ProposalLayout>({
              message: 'The AI can write proposals you answer by ticking options and commenting. How should they be organized?',
              options: [
                { value: 'structured', label: 'By topic and area', hint: 'docs/proposals/auth/…, services/docs/proposals/…' },
                { value: 'general', label: 'One folder', hint: 'docs/proposals/' },
              ],
            }),
          )
        : 'general'
      activateProposals(root, layout, mainDoc)
      if (created.length) p.log.success(`Created ${created.length} files: ${created.slice(0, 8).join(', ')}${created.length > 8 ? '…' : ''}`)
      p.log.info(`How it works: ${pc.cyan('docs/README.md')}. Skills: /mdrules-new-task, /mdrules-close-session.`)
      return { workflow: choice, section: methodSection(areas) }
    }

    let official = true
    if (choice === 'speckit' && !hasUv()) {
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
    const agentOptions = (Object.keys(SDD_AGENTS) as SddAgent[]).map((a) => ({ value: a, label: SDD_AGENTS[a].label }))
    // Spec Kit sets up one agent at init; OpenSpec any number.
    const agents: SddAgent[] = !official
      ? [initial]
      : choice === 'openspec'
        ? check(await p.multiselect({ message: 'Install the OpenSpec commands for which agents?', options: agentOptions, initialValues: [initial], required: false }))
        : [check(await p.select({ message: 'Install the Spec Kit commands for which agent?', options: agentOptions, initialValue: initial }))]

    const spin = p.spinner()
    spin.start(official ? `Installing ${WORKFLOW_LABEL[choice]}…` : 'Creating the structure…')
    const res = installWorkflow(root, choice, agents, official)
    spin.stop(res.official ? `${WORKFLOW_LABEL[choice]} installed` : 'Structure created')
    if (official && !res.official) p.log.warn(`Couldn't run the ${WORKFLOW_LABEL[choice]} installer:\n${pc.dim(res.error ?? '')}\nCreated the structure only.`)
    if (!res.official) p.log.info(`To add the AI commands later, see ${pc.cyan(WORKFLOW_GUIDE[choice])}.`)
    if (res.ignored.length) p.log.info(`Agent commands hidden in mdrules (${res.ignored.length} folders); the eye button in the sidebar shows them.`)
    return { workflow: choice }
  }
}

export async function runInit(root: string): Promise<ProjectConfig> {
  p.intro(pc.bgCyan(pc.black(' mdrules ')))
  const previous = readConfig(root)

  const mainDoc = await chooseMainDoc(root)
  const mainFile = path.join(root, mainDoc)

  const { workflow, section } = await chooseWorkflow(root, mainDoc, previous?.workflow)
  applyWorkflowToFile(mainFile, workflow, section)

  const mainText = fs.readFileSync(mainFile, 'utf8')
  const sourceLang = check(
    await p.select<Lang>({
      message: 'Language you work in (every .md file is written in it)',
      options: LANGS.map((l) => ({ value: l, label: LANG_NAMES[l], hint: l === 'en' ? 'default' : undefined })),
      initialValue: sourceLangOf(mainText),
    }),
  )

  // Translations to review the docs in are added on purpose, with `mdrules translate`.
  const langs = (previous?.langs ?? []).filter((l) => l !== sourceLang)

  const rules = listRules()
  const applied = appliedRuleIds(mainText)
  const selected = check(
    await p.multiselect({
      message: 'Which working rules apply to this project?',
      options: rules.map((r) => ({ value: r.id, label: r.title, hint: r.body.split('\n')[0].replace(/^- /, '') })),
      initialValues: applied,
      required: false,
    }),
  )
  applyRulesToFile(mainFile, selected, sourceLang)

  const subprojects = findSubprojects(scanTree(root))
  if (subprojects.length && selected.length) {
    const targets = check(
      await p.multiselect({
        message: 'Monorepo detected. Apply the same rules to these projects too?',
        options: subprojects.map((s) => ({ value: s, label: s })),
        required: false,
      }),
    )
    for (const dir of targets) {
      const doc = MAIN_DOCS.find((d) => fs.existsSync(path.join(root, dir, d)))!
      applyRulesToFile(path.join(root, dir, doc), selected, sourceLang)
    }
  }

  ensureGitignore(root)
  if (!previous) {
    const hide = check(await p.confirm({ message: 'Hide the .mdrules/ folder in VS Code?', initialValue: true }))
    if (hide && !hideInVsCode(root)) p.log.warn('.vscode/settings.json has comments; add "**/.mdrules": true to files.exclude by hand.')
  }
  installSkill(root)

  const config: ProjectConfig = { mainDoc, langs, langNames: previous?.langNames, workflow, proposals: readConfig(root)?.proposals, initializedAt: previous?.initializedAt ?? new Date().toISOString() }
  writeConfig(root, config)
  p.outro(`Ready. Skill installed in ${pc.cyan('.claude/skills/mdrules')}. To review the docs in another language: ${pc.cyan('mdrules translate')}`)
  return config
}
