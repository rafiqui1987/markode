import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { DEFAULT_SOURCE, GLOBAL_DIR, isLang, type Lang, LANG_NAMES, MAIN_DOCS, TEMPLATES_DIR } from './config.js'

export interface Rule {
  id: string
  title: string
  body: string
}

const rulesDir = () => path.join(GLOBAL_DIR, 'rules')
const START = '<!-- mdrules:rules:start -->'
const END = '<!-- mdrules:rules:end -->'

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Copy the bundled presets into ~/.mdrules/rules the first time. */
export function seedRules() {
  if (fs.existsSync(rulesDir())) return
  fs.mkdirSync(rulesDir(), { recursive: true })
  const src = path.join(TEMPLATES_DIR, 'rules')
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(rulesDir(), f))
}

function parseRule(id: string, text: string): Rule {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const meta = m ? (YAML.parse(m[1], { logLevel: 'error' }) ?? {}) : {}
  return { id, title: meta.title ?? id, body: (m ? m[2] : text).trim() }
}

export function listRules(): Rule[] {
  seedRules()
  return fs
    .readdirSync(rulesDir())
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseRule(f.slice(0, -3), fs.readFileSync(path.join(rulesDir(), f), 'utf8')))
    .sort((a, b) => a.title.localeCompare(b.title))
}

export function saveRule(rule: { id?: string; title: string; body: string }): Rule {
  seedRules()
  const id = rule.id || slugify(rule.title) || `rule-${Date.now()}`
  const text = `---\n${YAML.stringify({ title: rule.title }).trim()}\n---\n${rule.body.trim()}\n`
  fs.writeFileSync(path.join(rulesDir(), `${id}.md`), text)
  return { id, title: rule.title, body: rule.body.trim() }
}

export function deleteRule(id: string) {
  fs.rmSync(path.join(rulesDir(), `${path.basename(id)}.md`), { force: true })
}

/** Rule ids currently written into the managed section of a main doc. */
export function appliedRuleIds(docText: string): string[] {
  const section = extractSection(docText)
  if (!section) return []
  return [...section.matchAll(/<!-- rule:([\w-]+) -->/g)].map((m) => m[1])
}

function extractSection(text: string): string | null {
  const s = text.indexOf(START)
  const e = text.indexOf(END)
  return s >= 0 && e > s ? text.slice(s, e + END.length) : null
}

function writtenRules(docText: string): Record<string, Rule> {
  const section = extractSection(docText) ?? ''
  const out: Record<string, Rule> = {}
  for (const m of section.matchAll(/<!-- rule:([\w-]+) -->\n([\s\S]*?)(?=\n+<!-- (?:rule:|mdrules:rules:end))/g)) out[m[1]] = { id: m[1], title: m[1], body: m[2].trim() }
  return out
}

/** Source language declared in a main doc (shared with the team and the AI). */
export function sourceLangOf(docText: string): Lang {
  const m = /<!-- mdrules:source-lang:(\w+) -->/.exec(extractSection(docText) ?? '')
  return m && isLang(m[1]) ? m[1] : DEFAULT_SOURCE
}

/** Source language of a project: read from its main doc. */
export function projectSourceLang(root: string, mainDoc?: string | null): Lang {
  const doc = mainDoc ?? MAIN_DOCS.find((d) => fs.existsSync(path.join(root, d)))
  if (!doc) return DEFAULT_SOURCE
  try {
    return sourceLangOf(fs.readFileSync(path.join(root, doc), 'utf8'))
  } catch {
    return DEFAULT_SOURCE
  }
}

function renderSection(rules: Rule[], sourceLang: Lang): string {
  const body = rules.map((r) => `<!-- rule:${r.id} -->\n${r.body}`).join('\n\n')
  return [
    START,
    '## Working rules',
    '',
    'This project uses mdrules: follow `.claude/skills/mdrules/SKILL.md` when editing any `.md` file.',
    '',
    `<!-- mdrules:source-lang:${sourceLang} -->`,
    `- Source language of every \`.md\` file: **${LANG_NAMES[sourceLang]}** (\`${sourceLang}\`).`,
    ...(body ? ['', body] : []),
    END,
  ].join('\n')
}

/** Replace (or append) the managed rules section; the rest of the doc is untouched. */
export function applyRules(docText: string, rules: Rule[], sourceLang: Lang = sourceLangOf(docText)): string {
  const section = renderSection(rules, sourceLang)
  const existing = extractSection(docText)
  if (existing) return docText.replace(existing, section)
  return docText.replace(/\s*$/, '') + '\n\n' + section + '\n'
}

/** Write the managed section; `ids` / `sourceLang` default to what the file already has. */
export function applyRulesToFile(file: string, ids?: string[], sourceLang?: Lang) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const all = listRules()
  const written = writtenRules(text)
  // A rule already in the doc but missing from this machine's presets keeps its written body.
  const rules = (ids ?? appliedRuleIds(text)).map((id) => all.find((r) => r.id === id) ?? written[id]).filter((r): r is Rule => !!r)
  fs.writeFileSync(file, applyRules(text, rules, sourceLang ?? sourceLangOf(text)))
}
