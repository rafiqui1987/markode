import type { Lang } from './config.js'

/** Very common function words; enough to tell these languages apart in prose. */
const STOPWORDS: Record<Lang, string[]> = {
  en: ['the', 'and', 'is', 'are', 'of', 'to', 'in', 'for', 'with', 'this', 'that', 'it', 'on', 'be', 'as', 'by', 'not', 'or', 'from', 'when', 'each', 'use', 'should', 'will', 'can', 'all', 'has', 'have', 'which', 'only'],
  es: ['el', 'la', 'los', 'las', 'de', 'del', 'que', 'y', 'en', 'un', 'una', 'para', 'con', 'por', 'es', 'son', 'se', 'como', 'al', 'lo', 'más', 'pero', 'su', 'sus', 'este', 'esta', 'cuando', 'cada', 'debe', 'también'],
  fr: ['le', 'la', 'les', 'de', 'des', 'du', 'et', 'est', 'un', 'une', 'pour', 'dans', 'avec', 'que', 'qui', 'en', 'sur', 'par', 'pas', 'au', 'aux', 'ce', 'cette', 'sont', 'ou', 'chaque', 'doit', 'quand', 'aussi', 'être'],
  pt: ['o', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'que', 'e', 'em', 'um', 'uma', 'para', 'com', 'por', 'não', 'é', 'são', 'se', 'como', 'ao', 'mais', 'mas', 'seu', 'sua', 'cada', 'deve', 'quando', 'também'],
  de: ['der', 'die', 'das', 'und', 'ist', 'sind', 'ein', 'eine', 'zu', 'den', 'dem', 'mit', 'für', 'von', 'auf', 'nicht', 'auch', 'es', 'im', 'bei', 'wird', 'werden', 'oder', 'wenn', 'jede', 'jeder', 'soll', 'muss', 'kann', 'nur'],
  it: ['il', 'lo', 'la', 'gli', 'le', 'di', 'del', 'della', 'che', 'e', 'è', 'un', 'una', 'per', 'con', 'non', 'sono', 'si', 'come', 'al', 'alla', 'più', 'ma', 'suo', 'questo', 'questa', 'quando', 'ogni', 'deve', 'anche'],
}

const SETS = Object.fromEntries(Object.entries(STOPWORDS).map(([l, w]) => [l, new Set(w)])) as Record<Lang, Set<string>>

/** Human prose only: drop frontmatter, code, comments, links targets and table syntax. */
function prose(md: string): string {
  return md
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[|#>*_\-[\]()]/g, ' ')
}

/** Detected language of a Markdown text, or null when there isn't enough prose to tell. */
export function detectLang(md: string): Lang | null {
  const words = prose(md).toLowerCase().match(/[\p{L}]+/gu) ?? []
  if (words.length < 25) return null
  const scores = (Object.keys(SETS) as Lang[]).map((lang) => ({ lang, hits: words.reduce((n, w) => n + (SETS[lang].has(w) ? 1 : 0), 0) }))
  scores.sort((a, b) => b.hits - a.hits)
  const [best, second] = scores
  if (best.hits < 6 || best.hits < second.hits * 1.5) return null
  return best.lang
}
