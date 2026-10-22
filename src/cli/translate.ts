import * as p from '@clack/prompts'
import pc from 'picocolors'
import { isLang, isLangCode, LANG_NAMES, langName, LANGS, readConfig, writeConfig } from '../core/config.js'
import { projectSourceLang } from '../core/rules.js'

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
 * written by the AI (`/mdrules translate`). A language not built in can be typed: the AI translates the docs
 * into it, and the interface stays in English.
 */
export async function runTranslate(root: string) {
  const config = readConfig(root)
  if (!config) {
    console.log(`Run ${pc.cyan('mdrules init')} first.`)
    process.exitCode = 1
    return
  }
  p.intro(pc.bgCyan(pc.black(' mdrules translate ')))
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
    p.outro('No translation languages: mdrules shows the docs in their source language only.')
    return
  }
  p.outro(
    [
      `Translations: ${langs.map((l) => langName(l, { ...config, langNames: names })).join(', ')}.`,
      `Ask your agent for ${pc.cyan('/mdrules translate')} to translate the docs; then pick the language at the top of mdrules.`,
      ...(langs.some((l) => !isLang(l)) ? ['Menus stay in English for languages typed by hand.'] : []),
    ].join('\n'),
  )
}
