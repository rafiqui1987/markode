import fs from 'node:fs'
import path from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { type Lang, LANG_NAMES, LANGS, MAIN_DOCS, type ProjectConfig, readConfig, writeConfig } from '../core/config.js'
import { appliedRuleIds, applyRulesToFile, listRules, sourceLangOf } from '../core/rules.js'
import { createMainDoc, ensureGitignore, hideInVsCode, installSkill, scaffoldDocs } from '../core/scaffold.js'
import { findSubprojects, scanTree } from '../core/scan.js'

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

export async function runInit(root: string): Promise<ProjectConfig> {
  p.intro(pc.bgCyan(pc.black(' mdrules ')))
  const previous = readConfig(root)

  const mainDoc = await chooseMainDoc(root)
  const mainFile = path.join(root, mainDoc)

  if (!fs.existsSync(path.join(root, 'docs'))) {
    const create = check(await p.confirm({ message: 'Create the base /docs structure?', initialValue: true }))
    if (create) p.log.success(`Created ${scaffoldDocs(root).join(', ')}`)
  }

  const mainText = fs.readFileSync(mainFile, 'utf8')
  const sourceLang = check(
    await p.select<Lang>({
      message: 'Source language of the .md files (what the AI reads and writes)',
      options: LANGS.map((l) => ({ value: l, label: LANG_NAMES[l], hint: l === 'en' ? 'default' : undefined })),
      initialValue: sourceLangOf(mainText),
    }),
  )

  const langs = check(
    await p.multiselect<Lang>({
      message: 'Translation languages (view and edit docs in them; the source files never change language)',
      options: LANGS.filter((l) => l !== sourceLang).map((l) => ({ value: l, label: LANG_NAMES[l] })),
      initialValues: (previous?.langs ?? []).filter((l) => l !== sourceLang),
      required: false,
    }),
  )

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

  const config: ProjectConfig = { mainDoc, langs, initializedAt: previous?.initializedAt ?? new Date().toISOString() }
  writeConfig(root, config)
  p.outro(`Ready. Skill installed in ${pc.cyan('.claude/skills/mdrules')}`)
  return config
}
