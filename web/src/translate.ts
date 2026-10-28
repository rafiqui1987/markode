import { useCallback, useEffect, useRef, useState } from 'react'
import { segmentsOf, split } from '../../src/core/segments'
import { api, type Pending, type TranslationEngine } from './api'

/**
 * The browser's built-in Translator (Chrome/Edge 138+) as markode's translation engine. The tab drives
 * the work: what to translate comes from the server (`/api/translate/plan`), and the results go back to
 * it (`/api/translate/apply`). Without it, the agent translates (`/markode translate`).
 */

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available'
interface BrowserTranslator {
  translate(text: string): Promise<string>
}
interface Monitor {
  addEventListener(type: 'downloadprogress', listener: (e: { loaded: number }) => void): void
}
interface TranslatorApi {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>
  create(o: { sourceLanguage: string; targetLanguage: string; monitor?: (m: Monitor) => void }): Promise<BrowserTranslator>
}
interface LanguageDetectorApi {
  availability(): Promise<Availability>
  create(): Promise<{ detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]> }>
}

const Translator = (globalThis as { Translator?: TranslatorApi }).Translator
const LanguageDetector = (globalThis as { LanguageDetector?: LanguageDetectorApi }).LanguageDetector

export type Engine = 'browser' | 'agent'
export const browserEngineSupported = () => !!Translator
/** The engine that works: `auto` is the browser's when it has one, otherwise the agent. */
export const resolveEngine = (e: TranslationEngine): Engine => (e !== 'agent' && Translator ? 'browser' : 'agent')

/** The language pair's model has to be downloaded first, which the browser only allows after a click. */
export class NeedsDownload extends Error {
  constructor(
    public from: string,
    public to: string,
  ) {
    super(`The browser needs to download its ${from} → ${to} translation model`)
  }
}

const translators = new Map<string, Promise<BrowserTranslator>>()

/** The browser's translator for a pair; call it from a click to allow a model download. */
export async function browserTranslator(from: string, to: string, onProgress?: (loaded: number) => void): Promise<BrowserTranslator> {
  if (!Translator) throw new Error('This browser has no built-in translator: use Chrome or Edge 138+, or ask your agent for /markode translate')
  const id = `${from}>${to}`
  let t = translators.get(id)
  if (!t) {
    const availability = await Translator.availability({ sourceLanguage: from, targetLanguage: to })
    if (availability === 'unavailable') throw new Error(`The browser can't translate ${from} → ${to}: ask your agent for /markode translate`)
    if (availability !== 'available' && !navigator.userActivation?.isActive) throw new NeedsDownload(from, to)
    t = Translator.create({ sourceLanguage: from, targetLanguage: to, monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded)) })
    translators.set(id, t)
    t.catch(() => translators.delete(id))
  }
  return t
}

/** Texts in `items` translated from `from` into `to`, in the same order. */
export async function translateItems(engine: Engine, items: Pending[], from: string, to: string): Promise<string[]> {
  if (!items.length) return []
  if (engine === 'browser') {
    const tr = await browserTranslator(from, to)
    const out: string[] = []
    for (const item of items) out.push(await tr.translate(item.text))
    return out
  }
  throw new Error('The agent translates with /markode translate')
}

const toResults = (items: Pending[], texts: string[]) => Object.fromEntries(items.map((p, i) => [p.key, texts[i]]))

/** Translate one doc into `lang`: only the segments not cached; a lost placeholder is asked once more. */
export async function translateDoc(engine: Engine, path: string, lang: string) {
  const plan = await api.translatePlan(path, lang)
  if (plan.status !== 'missing' && plan.status !== 'outdated') return null
  const res = await api.translateApply(path, lang, toResults(plan.pending, await translateItems(engine, plan.pending, plan.from, lang)))
  if (!res.rejected.length) return res
  const retry = plan.pending.filter((p) => res.rejected.includes(p.key))
  return api.translateApply(path, lang, toResults(retry, await translateItems(engine, retry, plan.from, lang)), true)
}

export type BackResult =
  | { structural: true }
  | { structural: false; changes: { before: string; after: string }[]; results: Record<string, string>; rejected: number }

/** The source changes an edited translation would bring: its edited segments translated back. */
export async function translateBack(engine: Engine, path: string, lang: string): Promise<BackResult> {
  const plan = await api.backPlan(path, lang)
  if (plan.structural) return { structural: true }
  let results = toResults(plan.pending, await translateItems(engine, plan.pending, lang, plan.from))
  let proposal = await api.backPropose(path, lang, results)
  if (proposal.rejected.length) {
    const retry = plan.pending.filter((p) => proposal.rejected.includes(p.key))
    results = { ...results, ...toResults(retry, await translateItems(engine, retry, lang, plan.from)) }
    proposal = await api.backPropose(path, lang, results)
  }
  return { structural: false, changes: proposal.changes, results, rejected: proposal.rejected.length }
}

/**
 * Interface strings translated from English. `{name}` variables travel as numbered placeholders; a string
 * that loses one stays in English.
 */
export async function translateUi(engine: Engine, en: Record<string, string>, to: string, onProgress: (done: number, total: number) => void) {
  const entries = Object.entries(en)
  const out: Record<string, string> = {}
  for (let i = 0; i < entries.length; i += 25) {
    const chunk = entries.slice(i, i + 25).map(([key, value]) => {
      const vars: string[] = []
      const text = value.replace(/\{(\w+)\}/g, (m) => `{${vars.push(m) - 1}}`)
      return { key, value, vars, item: { key, text, terms: {} } }
    })
    const texts = await translateItems(engine, chunk.map((c) => c.item), 'en', to)
    chunk.forEach((c, k) => {
      const used = new Set<number>()
      const text = texts[k]?.replace(/\{\s*(\d+)\s*\}/g, (m, n) => (c.vars[Number(n)] ? (used.add(Number(n)), c.vars[Number(n)]) : m))
      out[c.key] = text && used.size === c.vars.length && !/\{\s*\d+\s*\}/.test(text) ? text : c.value
    })
    onProgress(Math.min(i + 25, entries.length), entries.length)
  }
  return out
}

let detector: ReturnType<LanguageDetectorApi['create']> | null = null

/**
 * The language of a doc's prose by the browser's Language Detector, when it has one ready (it is not
 * downloaded for this). Null without it, or with too little prose to tell.
 */
export async function detectLanguage(md: string): Promise<string | null> {
  if (!LanguageDetector) return null
  const prose = segmentsOf(split(md))
    .map((s) => s.text.replace(/\{\d+\}/g, ' '))
    .join('\n')
  if ((prose.match(/\p{L}+/gu) ?? []).length < 25) return null
  try {
    if (!detector) {
      if ((await LanguageDetector.availability()) !== 'available') return null
      detector = LanguageDetector.create()
    }
    const [best] = await (await detector).detect(prose)
    return best && best.confidence >= 0.7 ? best.detectedLanguage.split('-')[0] : null
  } catch {
    return null
  }
}

export interface AutoTranslateState {
  running: boolean
  done: number
  total: number
  /** `<lang> · <path>` being translated. */
  current?: string
  error?: string
  /** The browser engine waits for a click to download this pair's model. */
  needsDownload?: { from: string; to: string }
}

const IDLE: AutoTranslateState = { running: false, done: 0, total: 0 }

/**
 * Keeps translations up to date with a local engine while markode is open: everything missing or
 * outdated on start, and again whenever `run` is called (a source doc changed). One run at a time; a call
 * during a run makes it go once more.
 */
export function useAutoTranslate(enabled: boolean, engine: Engine, onWritten: () => void) {
  const [state, setState] = useState<AutoTranslateState>(IDLE)
  const busy = useRef(false)
  const again = useRef(false)
  const live = useRef({ enabled, engine, onWritten })
  live.current = { enabled, engine, onWritten }

  // A function, not an inline check: the engine can change while a run awaits.
  const off = () => !live.current.enabled || live.current.engine === 'agent'
  const run = useCallback(async () => {
    if (off()) return
    if (busy.current) {
      again.current = true
      return
    }
    busy.current = true
    try {
      do {
        again.current = false
        const { files } = await api.translateQueue()
        for (const [i, f] of files.entries()) {
          if (off()) break
          setState({ running: true, done: i, total: files.length, current: `${f.lang} · ${f.path}` })
          await translateDoc(live.current.engine as Engine, f.path, f.lang)
        }
      } while (again.current)
      setState(IDLE)
    } catch (err) {
      if (err instanceof NeedsDownload) setState({ ...IDLE, needsDownload: { from: err.from, to: err.to } })
      else setState({ ...IDLE, error: (err as Error).message })
    } finally {
      busy.current = false
      live.current.onWritten()
    }
  }, [])

  useEffect(() => {
    if (enabled && engine !== 'agent') run()
    else setState(IDLE)
  }, [enabled, engine, run])

  /** From a click: download the pair's model, then go on. */
  const download = useCallback(
    async (from: string, to: string) => {
      setState({ ...IDLE, running: true, current: `${from} → ${to}` })
      try {
        await browserTranslator(from, to, (loaded) => setState({ ...IDLE, running: true, done: Math.round(loaded * 100), total: 100, current: `${from} → ${to}` }))
        run()
      } catch (err) {
        setState({ ...IDLE, error: (err as Error).message })
      }
    },
    [run],
  )

  return { state, run, download }
}
