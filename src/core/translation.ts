import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { assertInside, safeResolve, stateDir } from './config.js'
import { allStatuses, markSynced, translationPath } from './i18n.js'
import { join, restore, type Segment, segmentsOf, split } from './segments.js'

/**
 * Segment translation: what an engine still has to translate in a file (`plan`), and the translation file
 * built from the cache once it has (`apply`). The engine in between is the browser's, in the markode tab,
 * or the agent (`markode translate --segments` / `--apply`).
 */

export interface Glossary {
  /** Terms never translated (product names, jargon), in any language. */
  keep: string[]
  /** Fixed translations per language: `{ es: { proposal: 'propuesta' } }`. */
  terms: Record<string, Record<string, string>>
}

/** A segment an engine has to translate. */
export interface Pending {
  key: string
  /** Prose with `{n}` placeholders (glossary `keep` terms included): every one must come back. */
  text: string
  /** Fixed translations of terms found in the text, for engines that can follow them (the agent). */
  terms: Record<string, string>
}

const glossaryFile = (root: string) => path.join(stateDir(root), 'glossary.json')
const cacheFile = (root: string, lang: string) => path.join(stateDir(root), 'cache', `${lang}.json`)

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()) : [])
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function readGlossary(root: string): Glossary {
  try {
    // Every field is checked: a repository can ship its own .markode/glossary.json.
    const raw = JSON.parse(fs.readFileSync(glossaryFile(root), 'utf8'))
    const terms: Glossary['terms'] = {}
    for (const [lang, map] of Object.entries(isObject(raw.terms) ? raw.terms : {})) {
      if (!isObject(map)) continue
      terms[lang] = Object.fromEntries(Object.entries(map).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[0].trim()))
    }
    return { keep: strings(raw.keep), terms }
  } catch {
    return { keep: [], terms: {} }
  }
}

export function writeGlossary(root: string, glossary: Glossary) {
  fs.mkdirSync(stateDir(root), { recursive: true })
  assertInside(glossaryFile(root))
  fs.writeFileSync(glossaryFile(root), JSON.stringify(glossary, null, 2) + '\n')
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** `term` as a whole word, any case. */
const wordRe = (term: string, flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}_])${escape(term)}(?![\\p{L}\\p{N}_])`, flags)

/**
 * Glossary entries that apply to `text`. `back`: the text is in `lang` and goes to the source language, so
 * fixed translations apply the other way round.
 */
function glossaryFor(g: Glossary, lang: string, text: string, back = false) {
  const pairs = Object.entries(g.terms[lang] ?? {}).map(([a, b]) => (back ? [b, a] : [a, b]))
  return {
    keep: g.keep.filter((t) => wordRe(t).test(text)),
    terms: Object.fromEntries(pairs.filter(([t]) => wordRe(t).test(text))),
  }
}

/**
 * Cache key of a segment: its text, the target language and the glossary entries it uses, so a glossary
 * change only invalidates the segments it touches.
 */
function keyOf(seg: Segment, lang: string, g: ReturnType<typeof glossaryFor>, back = false) {
  const extra = g.keep.length || Object.keys(g.terms).length ? '\0' + JSON.stringify(g) : ''
  return crypto.createHash('sha1').update(`${back ? 'back\0' : ''}${lang}\0${seg.text}${extra}`).digest('hex').slice(0, 16)
}

/** An engine's text in protected numbering, checked, with the kept terms turned back into words. */
function unprotect(seg: Segment, spans: string[], text: string): string | null {
  if (!restore({ ...seg, spans }, text).ok) return null
  const own = seg.spans.length
  return text.trim().replace(/\{\s*(\d+)\s*\}/g, (m, n) => (Number(n) >= own ? spans[Number(n)] : `{${n}}`))
}

/** `seg.text` with each `keep` term turned into one more placeholder, after the segment's own spans. */
function protectTerms(seg: Segment, keep: string[]): { text: string; spans: string[] } {
  const spans = [...seg.spans]
  let text = seg.text
  // Longest first, so "markode skill" wins over "markode".
  for (const term of [...keep].sort((a, b) => b.length - a.length)) {
    text = text.replace(wordRe(term, 'giu'), (m) => `{${spans.push(m) - 1}}`)
  }
  return { text, spans }
}

type Cache = Record<string, string>

function readCache(root: string, lang: string): Cache {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(root, lang), 'utf8'))
    return isObject(raw) ? (Object.fromEntries(Object.entries(raw).filter((e) => typeof e[1] === 'string')) as Cache) : {}
  } catch {
    return {}
  }
}

function writeCache(root: string, lang: string, cache: Cache) {
  const file = cacheFile(root, lang)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  assertInside(file)
  fs.writeFileSync(file, JSON.stringify(cache) + '\n')
}

/** Each segment of a source text with its cache key and the text an engine gets. */
function prepare(root: string, md: string, lang: string) {
  const doc = split(md)
  const glossary = readGlossary(root)
  const items = segmentsOf(doc).map((seg) => {
    const g = glossaryFor(glossary, lang, seg.text)
    return { seg, key: keyOf(seg, lang, g), protectedText: protectTerms(seg, g.keep), terms: g.terms }
  })
  return { doc, items }
}

const readSource = (root: string, rel: string) => fs.readFileSync(safeResolve(root, rel), 'utf8')

/** The segments of `rel` that have no cached translation into `lang` (each text once). */
export function plan(root: string, rel: string, lang: string): Pending[] {
  const cache = readCache(root, lang)
  const out = new Map<string, Pending>()
  for (const it of prepare(root, readSource(root, rel), lang).items) {
    if (!(it.key in cache) && !out.has(it.key)) out.set(it.key, { key: it.key, text: it.protectedText.text, terms: it.terms })
  }
  return [...out.values()]
}

export interface ApplyResult {
  /** Segments still without a translation. */
  missing: number
  /** Translations rejected because a placeholder was lost; they are asked again next time. */
  rejected: string[]
  /** The translation file was written; with `missing` segments still in the source language. */
  written: boolean
}

/**
 * Cache the engine's `results` (key → text) and, when every segment of `rel` has a translation, write the
 * translation file and mark it in sync. A result that lost a placeholder is not cached. With `partial`, the
 * file is written anyway, the missing segments left in the source language and the file not marked in sync.
 */
export function apply(root: string, rel: string, lang: string, results: Record<string, string>, partial = false): ApplyResult {
  const cache = readCache(root, lang)
  const { doc, items } = prepare(root, readSource(root, rel), lang)
  const rejected: string[] = []
  for (const it of items) {
    const t = results[it.key]
    if (typeof t !== 'string' || it.key in cache) continue
    const text = unprotect(it.seg, it.protectedText.spans, t)
    if (text === null) rejected.push(it.key)
    else cache[it.key] = text
  }
  writeCache(root, lang, cache)

  const missing = new Set(items.filter((it) => !(it.key in cache)).map((it) => it.key)).size
  if (missing && !partial) return { missing, rejected, written: false }
  const out = translationPath(root, lang, rel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  assertInside(out)
  fs.writeFileSync(out, join(doc, (_, i) => cache[items[i].key]))
  if (!missing) markSynced(root, lang, rel)
  return { missing, rejected, written: true }
}

/** Drop cached segments no source file uses any more. */
export function pruneCache(root: string, lang: string, rels: string[]) {
  const cache = readCache(root, lang)
  const used = new Set<string>()
  for (const rel of rels) {
    try {
      for (const it of prepare(root, readSource(root, rel), lang).items) used.add(it.key)
    } catch {}
  }
  writeCache(root, lang, Object.fromEntries(Object.entries(cache).filter(([k]) => used.has(k))))
}

/** Translation files that are missing or behind their source, in each of `langs`. */
export function queue(root: string, langs: string[]): { path: string; lang: string }[] {
  return langs.flatMap((lang) => allStatuses(root, lang).filter((e) => e.status === 'missing' || e.status === 'outdated').map((e) => ({ path: e.path, lang })))
}

// ------------------------------------------------------------ edited translations back to the source

/** Segments of an edited translation that differ from what markode wrote, and what goes to the engine. */
function backState(root: string, rel: string, lang: string) {
  const source = readSource(root, rel)
  const translation = fs.readFileSync(translationPath(root, lang, rel), 'utf8')
  const cache = readCache(root, lang)
  const { doc, items } = prepare(root, source, lang)
  const glossary = readGlossary(root)
  // What markode wrote, rebuilt from the cache: without it (a translation the agent wrote) there is
  // nothing to compare against.
  const complete = items.every((it) => it.key in cache)
  const expected = split(join(doc, (_, i) => cache[items[i].key]))
  const actual = split(translation)
  const kept = (d: typeof doc) => d.parts.filter((p) => typeof p === 'string').join('\u0001')
  const e = segmentsOf(expected)
  const a = segmentsOf(actual)
  const structural = !complete || e.length !== items.length || a.length !== e.length || kept(expected) !== kept(actual)
  const changed = structural
    ? []
    : a.flatMap((seg, i) => {
        if (seg.text === e[i].text) return []
        const g = glossaryFor(glossary, lang, seg.text, true)
        return [{ index: i, seg, key: keyOf(seg, lang, g, true), protectedText: protectTerms(seg, g.keep), terms: g.terms }]
      })
  return { source, doc, items, structural, changed }
}

/**
 * What the engine has to translate back into the source language for an edited translation
 * (`pending-sync`). `structural`: paragraphs, code or tables were added or removed, or markode didn't
 * write this translation; the agent handles that one.
 */
export function backPlan(root: string, rel: string, lang: string): { pending: Pending[]; structural: boolean } {
  const st = backState(root, rel, lang)
  return { structural: st.structural, pending: st.changed.map((c) => ({ key: c.key, text: c.protectedText.text, terms: c.terms })) }
}

export interface BackProposal {
  /** The source file with the edited segments replaced; everything else byte for byte. */
  source: string
  changes: { before: string; after: string }[]
  /** Translations that lost a placeholder: not in `source`. */
  rejected: string[]
}

/** The source file the engine's `results` (key → text in the source language) would give. Writes nothing. */
export function backPropose(root: string, rel: string, lang: string, results: Record<string, string>): BackProposal & { st: ReturnType<typeof backState>; texts: Map<number, string> } {
  const st = backState(root, rel, lang)
  const rejected: string[] = []
  const texts = new Map<number, string>()
  for (const c of st.changed) {
    const t = results[c.key]
    const text = typeof t === 'string' ? unprotect(c.seg, c.protectedText.spans, t) : null
    if (text === null) rejected.push(c.key)
    else texts.set(c.index, text)
  }
  // The spans (code, links) come from the edited translation: the user may have changed them too.
  let n = 0
  const parts = st.doc.parts.map((p) => {
    if (typeof p === 'string') return p
    const c = st.changed.find((x) => x.index === n++)
    return c && texts.has(c.index) ? { ...p, spans: c.seg.spans } : p
  })
  const source = join({ ...st.doc, parts }, (_, i) => texts.get(i))
  const changes = [...texts].map(([i, text]) => ({ before: st.items[i].seg.raw, after: restore(st.changed.find((c) => c.index === i)!.seg, text).text }))
  return { source, changes, rejected, st, texts }
}

/**
 * Write the proposed source, keep the edited translation as the cached translation of the new text, and
 * mark the pair in sync. The other languages become outdated and are translated again.
 */
export function backAccept(root: string, rel: string, lang: string, results: Record<string, string>): { before: string; source: string } {
  const p = backPropose(root, rel, lang, results)
  if (p.rejected.length || p.texts.size !== p.st.changed.length) throw new Error('Some edited segments have no translation back yet')
  const file = safeResolve(root, rel)
  fs.writeFileSync(file, p.source)
  const next = prepare(root, p.source, lang)
  if (next.items.length === p.st.items.length) {
    const cache = readCache(root, lang)
    for (const c of p.st.changed) cache[next.items[c.index].key] = c.seg.text
    writeCache(root, lang, cache)
  }
  markSynced(root, lang, rel)
  return { before: p.st.source, source: p.source }
}
