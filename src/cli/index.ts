import fs from 'node:fs'
import path from 'node:path'
import { checkDocs } from '../core/check.js'
import { PKG_ROOT, readConfig, writeConfig } from '../core/config.js'
import { readDefaults, type SetupDefaults } from '../core/defaults.js'
import { keepLanguage, markSynced, syncReport } from '../core/i18n.js'
import { linkMainDocs, missingMainDocs } from '../core/scaffold.js'
import { answerSummary, waitForAnswer } from '../core/wait.js'
import { startServer } from '../server/index.js'
import { runInit, runSetup } from './init.js'
import { runTranslate } from './translate.js'

const HELP = `markode — visual editor for your project's Markdown

Usage
  markode                 init if needed, then open the editor
  markode init            (re)run the project setup: main doc, specs structure, rules, languages
  markode setup           choose how projects are set up: with your saved answers, or asking each time
  markode serve           open the editor without running init
  markode translate       choose languages to review the docs in (or: markode --translate)
  markode check [--json]  what /markode sync fixes: answered proposals, phases vs tasks, projects table, broken links
  markode wait <proposal> wait until the user answers a proposal in markode, then print the answer
  markode link [--dry-run] where there is only CLAUDE.md or only AGENTS.md, add the other one pointing to it
  markode link --skip     don't offer it again in this project

For the agent's /markode translate:
  markode translate --status [--json]                    translations + files not in the source language
  markode translate --mark [--lang xx] <path...>|--all   record translations as in sync
  markode translate --keep <path...>                     keep files in their current language

Options
  -v, --version  print the version
  -D           first run: skip saving defaults; every project asks its own questions
  --custom     init: ask every question for this project, ignoring your defaults
  --port <n>   server port (default 4319)
  --no-open    do not open the browser
`

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const command = args[0] && !args[0].startsWith('-') ? args[0] : 'start'
const root = process.env.MARKODE_ROOT ?? process.cwd()

async function main() {
  if (flag('--help') || flag('-h')) return console.log(HELP)
  if (flag('--version') || flag('-v')) return console.log(JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version)

  // `sync --status|--mark|--keep` is the name older skills use for the translation commands.
  const translation = flag('--status') || flag('--mark') || flag('--keep')
  if ((command === 'sync' || command === 'translate') && translation) return sync()
  if (command === 'translate' || flag('--translate')) return runTranslate(root)
  if (command === 'check') return check()
  if (command === 'wait') return wait()
  if (command === 'link') return link()
  if (command === 'setup') {
    await runSetup(flag('-D'))
    return
  }
  if (command === 'init') {
    await runInit(root, flag('--custom') ? null : await defaults())
    return
  }
  if (command === 'start' && !readConfig(root)) {
    if (process.stdin.isTTY) await runInit(root, flag('--custom') ? null : await defaults())
    // Saved defaults need no answers, so they also apply without a terminal.
    else if (readDefaults()?.mode === 'defaults') await runInit(root, readDefaults())
  }
  const unlinked = command === 'start' && process.stdout.isTTY && !readConfig(root)?.skipLink ? missingMainDocs(root) : []
  if (unlinked.length)
    console.log(`Tip: Claude Code reads CLAUDE.md and other agents read AGENTS.md; ${unlinked.map((m) => m.path).join(', ')} missing. Run \`markode link\` (or \`markode link --skip\`).`)
  if (command === 'start' || command === 'serve') {
    await startServer({ root, port: Number(option('--port') ?? 4319), open: !flag('--no-open') })
    return
  }
  console.log(HELP)
  process.exitCode = 1
}

/** The user's defaults when projects use them, null to ask; the first time, choose (or -D to always ask). */
async function defaults(): Promise<SetupDefaults | null> {
  const d = readDefaults() ?? (process.stdin.isTTY ? await runSetup(flag('-D')) : null)
  return d?.mode === 'defaults' ? d : null
}

function check() {
  const report = checkDocs(root)
  if (flag('--json')) return console.log(JSON.stringify(report, null, 2))
  const lines = [
    ...report.proposals.map((p) => `answered proposal  ${p}`),
    ...report.phases.map((p) => `phase vs task      ${p.phase}: ${p.task} is ${p.status || 'without status'} but ${p.ticked ? 'ticked' : 'not ticked'}`),
    ...(report.projects?.missing ?? []).map((d) => `project not listed ${d}/`),
    ...(report.projects?.gone ?? []).map((d) => `project gone       ${d}/`),
    ...report.links.map((l) => `broken link        ${l.file}:${l.line} → ${l.target}`),
  ]
  console.log(lines.length ? lines.join('\n') : 'Docs are consistent.')
}

/** Claude Code reads CLAUDE.md, other agents AGENTS.md: give each folder both, one pointing to the other. */
function link() {
  const config = readConfig(root)
  if (flag('--skip')) {
    if (config) writeConfig(root, { ...config, skipLink: true })
    return console.log('markode won\'t offer to link CLAUDE.md and AGENTS.md in this project again.')
  }
  // A dry run is how the agent checks at the start of a session: say nothing once the user declined.
  if (flag('--dry-run') && config?.skipLink) return console.log('Skipped: the user chose not to link the main docs.')
  const missing = missingMainDocs(root)
  if (!missing.length) return console.log('Every main doc has its CLAUDE.md and AGENTS.md (or neither).')
  if (flag('--dry-run')) return console.log(missing.map((m) => `would create ${m.path} → ${m.pointsTo}`).join('\n'))
  for (const p of linkMainDocs(root)) console.log(`created ${p}`)
}

async function wait() {
  const rel = args[1]
  if (!rel || !fs.existsSync(path.join(root, rel))) {
    console.error(`Usage: markode wait <proposal.md> (relative to ${root})`)
    process.exitCode = 1
    return
  }
  const result = await waitForAnswer(root, rel)
  if (result === 'gone') {
    console.log(`${rel} was deleted or is no longer a proposal.`)
    process.exit(0)
  }
  console.log(answerSummary(root, rel))
  process.exit(0)
}

function sync() {
  const report = syncReport(root)
  const paths = (after: string) => args.slice(args.indexOf(after) + 1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--lang')

  if (flag('--keep')) {
    for (const p of paths('--keep')) {
      try {
        console.log(`kept    ${p} (${keepLanguage(root, p)})`)
      } catch (err) {
        console.error(`skipped ${p}: ${(err as Error).message}`)
      }
    }
    return
  }

  if (flag('--mark')) {
    const only = option('--lang')
    const langs = only && report.langs.includes(only) ? [only] : report.langs
    const files = flag('--all') ? [...new Set(report.files.map((f) => f.path))] : paths('--mark')
    for (const p of files) {
      for (const l of langs) {
        try {
          markSynced(root, l, p)
          console.log(`synced  ${l} ${p}`)
        } catch (err) {
          if (!flag('--all')) console.error(`skipped ${l} ${p}: ${(err as Error).message}`)
        }
      }
    }
    return
  }

  if (flag('--json')) return console.log(JSON.stringify(report, null, 2))
  console.log(`Source language: ${report.sourceLang}   Translations: ${report.langs.join(', ') || 'none'}`)
  if (report.foreign.length) {
    console.log(`\nNot in ${report.sourceLang}:`)
    for (const f of report.foreign) console.log(`  ${f.detected}  ${f.path}`)
  }
  const pending = report.files.filter((f) => f.status !== 'synced')
  if (pending.length) console.log('')
  for (const e of pending) console.log(`${e.lang}  ${e.status.padEnd(13)} ${e.path}`)
  if (!pending.length && !report.foreign.length) console.log('Everything in sync.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
