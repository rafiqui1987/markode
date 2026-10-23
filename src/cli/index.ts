import fs from 'node:fs'
import path from 'node:path'
import { formatChanges, startSession, takeChanges } from '../core/changes.js'
import { checkDocs } from '../core/check.js'
import { PKG_ROOT, readConfig, setProjectRoot, writeConfig } from '../core/config.js'
import { BASE_DEFAULTS, readDefaults, writeDefaults } from '../core/defaults.js'
import { FEATURE_INFO, FEATURES, featureState, isFeature, isProfile, PROFILE_FEATURES, refreshInstalled, REQUIRES, setFeature } from '../core/features.js'
import { keepLanguage, markSynced, syncReport } from '../core/i18n.js'
import { linkMainDocs, missingMainDocs } from '../core/scaffold.js'
import { editorUrl, ensureServer, runningServer } from '../core/server.js'
import { CURRENT_VERSION, installCommand, installer, isNewer, latestVersion, runInstall } from '../core/update.js'
import { answerSummary, waitForAnswer } from '../core/wait.js'
import { startServer } from '../server/index.js'
import { askFeatures, type InitPlan, runInit, runSetup } from './init.js'
import { runTranslate } from './translate.js'

const HELP = `markode — visual editor for your project's Markdown

Usage
  markode                 set the project up if needed, then open the editor
  markode init            (re)run the project setup: choose the modules to install (or use your defaults)
  markode setup           choose how projects are set up: always the same modules, or asking each time
  markode features        list the modules and whether they are on in this project
  markode features <module> on|off   turn a module on or off (same as Settings → Features)
  markode serve           open the editor without running init
  markode url [<doc.md>]  the editor's link (or a doc's), starting it in the background if it isn't running
  markode stop            stop the editor running in the background for this project
  markode translate       choose languages to review the docs in (or: markode --translate)
  markode check [--json]  what /markode sync fixes: answered proposals, phases vs tasks, projects table, broken links
  markode wait <proposal> wait until the user answers a proposal in markode, then print the answer
  markode link [--dry-run] where there is only CLAUDE.md or only AGENTS.md, add the other one pointing to it
  markode link --skip     don't offer it again in this project
  markode changes [--json] what the user edited or commented in markode since the agent was last told
  markode changes --start  a new agent session: what happened before is old news
  markode changes --hook <event>  the same, as Claude Code hook output (silent when nothing changed)
  markode update [--check] install the latest version now, without the day npm/pnpm wait for new releases
  markode update --pnpm|--npm  the same, choosing the package manager to install it with

For the agent's /markode translate:
  markode translate --status [--json]                    translations + files not in the source language
  markode translate --mark [--lang xx] <path...>|--all   record translations as in sync
  markode translate --keep <path...>                     keep files in their current language

Options
  -v, --version  print the version
  -D           first run: don't save your choice as the default for new projects
  --profile <viewer|agent|full>  init: install this set of modules, without questions
  --yes        init: no questions; your defaults, or the recommended modules (viewer + AI agent)
  --custom     init: choose each module and answer every question for this project
               setup: also choose the main doc, language, rules and monorepo layout
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
  // Every write markode makes is checked against the real path of the project (see assertInside).
  if (fs.existsSync(root)) setProjectRoot(root)
  if (flag('--help') || flag('-h')) return console.log(HELP)
  if (flag('--version') || flag('-v')) return console.log(JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version)

  // `sync --status|--mark|--keep` is the name older skills use for the translation commands.
  const translation = flag('--status') || flag('--mark') || flag('--keep')
  if ((command === 'sync' || command === 'translate') && translation) return sync()
  if (command === 'translate' || flag('--translate')) return runTranslate(root)
  // What an agent runs at the start of a session: it also brings an older skill up to this version, so
  // commands added since (e.g. `/markode` opening the editor) work without starting the editor first.
  if (['check', 'url', 'link'].includes(command) || (command === 'changes' && flag('--start'))) refreshInstalled(root)
  if (command === 'check') return check()
  if (command === 'wait') return wait()
  if (command === 'link') return link()
  if (command === 'changes') return changes()
  if (command === 'url') return url()
  if (command === 'stop') return stop()
  if (command === 'update') return update()
  if (command === 'features') return features()
  if (command === 'setup') {
    await runSetup(false, flag('--custom'))
    return
  }
  if (command === 'init') {
    const p = await plan()
    if (p) await runInit(root, p)
    else console.log('No terminal to ask in: run `markode init --yes` or `--profile <viewer|agent|full>`.')
    return
  }
  // Other settings (e.g. `link --skip`) can be saved before the setup ran: only `init` sets initializedAt.
  if (command === 'start' && !readConfig(root)?.initializedAt) {
    const p = await plan()
    if (p) await runInit(root, p)
  }
  // Skills and sections markode installed follow the installed version, without another init.
  if (command === 'start' || command === 'serve') refreshInstalled(root)
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

/**
 * What `init` installs, with as few questions as possible: `--profile`, `--yes` or the saved defaults need
 * none; otherwise one question (which modules), saved the first time as the default for new projects.
 * Null when it would have to ask and there is no terminal.
 */
async function plan(): Promise<InitPlan | null> {
  const saved = readDefaults()
  const d = saved ?? BASE_DEFAULTS
  const profile = option('--profile')
  if (flag('--custom')) return { features: await askFeatures(), defaults: null }
  if (profile) {
    if (!isProfile(profile)) throw new Error(`Unknown profile "${profile}": use viewer, agent or full`)
    return { features: PROFILE_FEATURES[profile], defaults: d }
  }
  if (saved?.mode === 'defaults' || flag('--yes')) return { features: d.features, defaults: d }
  if (!process.stdin.isTTY) return null
  const features = await askFeatures()
  if (!saved && !flag('-D')) {
    writeDefaults({ ...d, mode: 'defaults', features })
    console.log(`  Saved as your default for new projects (they won't ask again). Change it with \`markode setup\`.`)
  }
  return { features, defaults: d }
}

/** List the modules, or turn one on or off: the same as Settings → Features. */
function features() {
  const [id, value] = [args[1], args[2]]
  if (id) {
    if (!isFeature(id) || (value !== 'on' && value !== 'off')) {
      console.error(`Usage: markode features <${FEATURES.join('|')}> on|off`)
      process.exitCode = 1
      return
    }
    const changed = setFeature(root, id, value === 'on', readDefaults() ?? BASE_DEFAULTS)
    for (const [f, on] of Object.entries(changed)) console.log(`${on ? 'on ' : 'off'}  ${FEATURE_INFO[f as keyof typeof FEATURE_INFO].label}`)
    if (!Object.keys(changed).length) console.log(`${FEATURE_INFO[id].label} was already ${value}.`)
    return
  }
  const state = featureState(root)
  console.log('on   Viewer — see and edit every .md file of the project (always on)')
  for (const f of FEATURES) console.log(`${state[f] ? 'on ' : 'off'}  ${FEATURE_INFO[f].label} — ${FEATURE_INFO[f].hint}${REQUIRES[f] ? ` (needs ${FEATURE_INFO[REQUIRES[f]!].label})` : ''}`)
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
    writeConfig(root, { ...(config ?? { mainDoc: null, langs: [] }), skipLink: true })
    return console.log('markode won\'t offer to link CLAUDE.md and AGENTS.md in this project again.')
  }
  // A dry run is how the agent checks at the start of a session: say nothing once the user declined.
  if (flag('--dry-run') && config?.skipLink) return console.log('Skipped: the user chose not to link the main docs.')
  const missing = missingMainDocs(root)
  if (!missing.length) return console.log('Every main doc has its CLAUDE.md and AGENTS.md (or neither).')
  if (flag('--dry-run')) return console.log(missing.map((m) => `would create ${m.path} → ${m.pointsTo}`).join('\n'))
  for (const p of linkMainDocs(root)) console.log(`created ${p}`)
}

/** For the agent's `/markode`: a link the user clicks in the terminal; `/open` reuses the markode tab. */
async function url() {
  const doc = args[1] && !args[1].startsWith('-') ? args[1] : undefined
  if (doc && (!doc.toLowerCase().endsWith('.md') || !fs.existsSync(path.join(root, doc)))) {
    console.error(`Usage: markode url [<doc.md>] (relative to ${root})`)
    process.exitCode = 1
    return
  }
  const { port } = await ensureServer(root, process.argv[1], Number(option('--port') ?? 4319))
  console.log(editorUrl(port, doc))
}

function stop() {
  const running = runningServer(root)
  if (!running) return console.log('The editor is not running for this project.')
  process.kill(running.pid)
  console.log(`Stopped the editor on port ${running.port}.`)
}

/** Install the version just published: pnpm and npm can hold back releases younger than a day. */
async function update() {
  const latest = await latestVersion()
  if (!isNewer(latest, CURRENT_VERSION)) return console.log(`markode ${CURRENT_VERSION} is the latest version.`)
  console.log(`markode ${latest} is out (you have ${CURRENT_VERSION}).`)
  if (flag('--check')) return
  const via = flag('--pnpm') ? 'pnpm' : flag('--npm') ? 'npm' : installer()
  if (via === 'npx') return console.log(`Running through npx: use \`npx -y @rafiqui987/markode@${latest}\` once to fetch it, or install it with \`markode update --pnpm\` (or --npm).`)
  if (!via) return console.log('This copy runs from a clone of the repository: pull and build it, or install it with `markode update --pnpm` (or --npm).')
  const cmd = installCommand(via, latest)
  console.log(`$ ${cmd.join(' ')}`)
  if (runInstall(cmd)) return console.log(`Updated to ${latest}. The next \`markode url\` (or /markode) restarts a running editor with it.`)
  console.error('The install failed; the output above says why.')
  process.exitCode = 1
}

function changes() {
  if (flag('--start')) return startSession(root)
  const list = takeChanges(root)
  const event = option('--hook')
  if (event) {
    const text = formatChanges(list)
    if (text) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }))
    return
  }
  if (flag('--json')) return console.log(JSON.stringify(list, null, 2))
  console.log(formatChanges(list) || 'No edits or comments from the user since you were last told.')
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
