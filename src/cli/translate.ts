import fs from 'node:fs'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import { isLang, isLangCode, LANG_NAMES, langName, LANGS, readConfig, writeConfig } from '../core/config.js'
import { projectSourceLang } from '../core/rules.js'
import { apply, plan, pruneCache, queue } from '../core/translation.js'
import { flattenFiles, scanTree } from '../core/scan.js'

function check<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }
  return value as Exclude<T, symbol>
}

const OTHER = '__other__'

/**
 * Pick the languages to review the docs in. The files stay in the source language; translations are
 * written by the AI (`/markode translate`). A language not built in can be typed: the AI translates the docs
 * into it, and the interface stays in English.
 */
export async function runTranslate(root: string) {
  const config = readConfig(root)
  if (!config) {
    console.log(`Run ${pc.cyan('markode init')} first.`)
    process.exitCode = 1
    return
  }
  p.intro(pc.bgCyan(pc.black(' markode translate ')))
  const source = projectSourceLang(root, config.mainDoc)
  const custom = config.langs.filter((l) => !isLang(l))
  const picked = check(
    await p.multiselect<string>({
      message: `Languages to review the docs in (the files stay in ${langName(source)})`,
      options: [
        ...LANGS.filter((l) => l !== source).map((l) => ({ value: l, label: LANG_NAMES[l] })),
        ...custom.map((l) => ({ value: l, label: `${langName(l, config)} (${l})`, hint: 'interface in English' })),
        { value: OTHER, label: 'Another language…', hint: 'type it; the interface stays in English' },
      ],
      initialValues: config.langs.filter((l) => l !== source),
      required: false,
    }),
  )

  const langs = picked.filter((l) => l !== OTHER)
  const names = { ...(config.langNames ?? {}) }
  if (picked.includes(OTHER)) {
    for (;;) {
      const name = check(await p.text({ message: 'Language name (as the AI should understand it)', placeholder: 'Japanese', validate: (v) => (v?.trim() ? undefined : 'Type a language') })).trim()
      const code = check(
        await p.text({
          message: `Short code for ${name} (folder name of its translations)`,
          initialValue: name.slice(0, 2).toLowerCase(),
          validate: (v) => (!isLangCode(v) ? 'Two or three letters, e.g. ja or zh-tw' : v === source || langs.includes(v!) ? 'Already in the list' : undefined),
        }),
      ).toLowerCase()
      langs.push(code)
      names[code] = name
      if (!check(await p.confirm({ message: 'Add another language?', initialValue: false }))) break
    }
  }

  writeConfig(root, { ...config, langs, langNames: names })
  if (!langs.length) {
    p.outro('No translation languages: markode shows the docs in their source language only.')
    return
  }
  p.outro(
    [
      `Translations: ${langs.map((l) => langName(l, { ...config, langNames: names })).join(', ')}.`,
      `In Chrome or Edge, markode translates them by itself while it is open; otherwise ask your agent for ${pc.cyan('/markode translate')}. Then pick the language at the top of markode.`,
      ...(langs.some((l) => !isLang(l)) ? ['Menus stay in English for languages typed by hand.'] : []),
    ].join('\n'),
  )
}

const pathArgs = (args: string[]) => args.slice(1).filter((a, i, all) => !a.startsWith('--') && !['--lang', '--apply'].includes(all[i - 1]))

/** The translations to do: missing or outdated, in the enabled languages (or `--lang`), for `paths` (or all). */
function work(root: string, lang: string | undefined, paths: string[]) {
  const config = readConfig(root)
  const source = projectSourceLang(root, config?.mainDoc)
  const langs = (config?.langs ?? []).filter((l) => l !== source && (!lang || l === lang))
  return { source, names: Object.fromEntries((config?.langs ?? []).map((l) => [l, langName(l, config)])), files: queue(root, langs).filter((f) => !paths.length || paths.includes(f.path)) }
}

/** `markode translate --segments` / `--apply`: the segments still to translate, for the agent's `/markode translate`. */
export function runSegments(root: string, args: string[], option: (name: string) => string | undefined, flag: (name: string) => boolean) {
  const { source, names, files } = work(root, option('--lang'), pathArgs(args))

  if (flag('--segments')) {
    const out = files.map((f) => ({ ...f, pending: plan(root, f.path, f.lang) })).filter((f) => f.pending.length)
    return console.log(JSON.stringify({ sourceLang: source, names, files: out }, null, 2))
  }

  // { "<lang>": { "<key>": "<translated text>" } }: keys are per language, so one map serves every file.
  const all = JSON.parse(fs.readFileSync(option('--apply')!, 'utf8')) as Record<string, Record<string, string>>
  for (const f of files) {
    const res = apply(root, f.path, f.lang, all[f.lang] ?? {})
    const note = res.rejected.length ? ` (${res.rejected.length} lost a placeholder: translate them again)` : res.missing ? ` (${res.missing} segments missing)` : ''
    console.log(`${res.written ? 'written' : 'pending'} ${f.lang} ${f.path}${note}`)
  }
  // Segments no doc uses any more.
  const docs = flattenFiles(scanTree(root)).map((f) => f.path)
  for (const lang of Object.keys(all)) if (names[lang]) pruneCache(root, lang, docs)
}
