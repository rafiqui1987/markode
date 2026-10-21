import { isLang, readConfig } from '../core/config.js'
import { keepLanguage, markSynced, syncReport } from '../core/i18n.js'
import { startServer } from '../server/index.js'
import { runInit } from './init.js'

const HELP = `mdrules — visual editor for your project's Markdown

Usage
  mdrules                 init if needed, then open the editor
  mdrules init            (re)run the setup: main doc, docs/, rules, language
  mdrules serve           open the editor without running init
  mdrules sync --status [--json]                    translations + files not in the source language
  mdrules sync --mark [--lang xx] <path...>|--all   record translations as in sync
  mdrules sync --keep <path...>                     keep files in their current language

Options
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
const root = process.env.MDRULES_ROOT ?? process.cwd()

async function main() {
  if (flag('--help') || flag('-h')) return console.log(HELP)

  if (command === 'sync') return sync()
  if (command === 'init') {
    await runInit(root)
    return
  }
  if (command === 'start' && !readConfig(root)) {
    if (process.stdin.isTTY) await runInit(root)
  }
  if (command === 'start' || command === 'serve') {
    await startServer({ root, port: Number(option('--port') ?? 4319), open: !flag('--no-open') })
    return
  }
  console.log(HELP)
  process.exitCode = 1
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
    const langs = only && isLang(only) ? [only] : report.langs
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
