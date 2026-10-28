import fs from 'node:fs'
import { safeResolve } from './config.js'
import { markSynced, translationPath } from './i18n.js'
import { backPlan } from './translation.js'

/**
 * A proposal answered in a translation: the answer goes to the source, which is what `markode wait` and
 * the agent read. Nothing is translated: the ticks, `status`/`updated` and the new comments are copied by
 * position, which holds because a translation keeps its source's structure.
 */

interface Anchor {
  kind: 'fence' | 'h' | 'li' | 'tr' | 'hr' | 'p'
  line: number
  /** Last line of the block (continuation lines, a code block's body). */
  last: number
}

const COMMENT_LINE = /^\s*<!--[\s\S]*-->\s*$/
/** A comment or reply of a thread (`<!-- comment by … -->`), the only ones a user adds by answering. */
const THREAD = /^\s*<!-- (comment|reply) by /
const QUOTE = /^\s*(?:>\s*)*/

/** The blocks of a doc, in order, and its thread comments with the block each one follows (-1: none). */
function outline(text: string) {
  const lines = text.split('\n')
  const fmEnd = lines[0]?.trimEnd() === '---' ? lines.findIndex((l, j) => j > 0 && l.trimEnd() === '---') : -1
  const anchors: Anchor[] = []
  const comments: { line: number; anchor: number }[] = []
  let fence: RegExp | null = null
  let inComment = false
  // Whether the last line (comments aside) was prose a next line can continue.
  let prose = false
  for (let i = fmEnd + 1; i < lines.length; i++) {
    const l = lines[i]
    if (fence) {
      anchors[anchors.length - 1].last = i
      if (fence.test(l.replace(QUOTE, ''))) fence = null
      continue
    }
    if (inComment) {
      if (l.includes('-->')) inComment = false
      continue
    }
    if (/^\s*<!--/.test(l) && !l.includes('-->')) {
      inComment = true
      continue
    }
    if (COMMENT_LINE.test(l)) {
      if (THREAD.test(l)) comments.push({ line: i, anchor: anchors.length - 1 })
      continue
    }
    if (!l.trim()) {
      prose = false
      continue
    }
    const f = /^\s*(?:>\s*)*(`{3,}|~{3,})/.exec(l)
    if (f) {
      fence = new RegExp(`^${f[1][0] === '`' ? '`' : '~'}{${f[1].length},}\\s*$`)
      anchors.push({ kind: 'fence', line: i, last: i })
      prose = false
      continue
    }
    const kind: Anchor['kind'] | null = /^\s*(?:>\s*)*#{1,6}\s/.test(l)
      ? 'h'
      : /^\s*(?:>\s*)*([-*+]|\d{1,9}[.)])\s/.test(l)
        ? 'li'
        : /^\s*(?:>\s*)*\|/.test(l)
          ? 'tr'
          : /^\s*([-*_])(\s*\1){2,}\s*$/.test(l)
            ? 'hr'
            : prose
              ? null
              : 'p'
    if (kind) anchors.push({ kind, line: i, last: i })
    else anchors[anchors.length - 1].last = i
    prose = kind === 'p' || kind === 'li' || kind === null
  }
  return { lines, fmEnd, anchors, comments }
}

const TASK = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])\]/

/** The source with the answer given in `translation`: ticks, `status`/`updated`, new thread comments. */
export function carryAnswerText(source: string, translation: string): string {
  const s = outline(source)
  const t = outline(translation)
  if (s.anchors.length !== t.anchors.length || s.anchors.some((a, i) => a.kind !== t.anchors[i].kind))
    throw new Error('The translation no longer has the structure of the original (paragraphs, lists or tables were added or removed)')
  const out = [...s.lines]

  // Ticks: the same list item in both.
  s.anchors.forEach((a, i) => {
    if (a.kind !== 'li') return
    const mine = TASK.exec(out[a.line])
    const theirs = TASK.exec(t.lines[t.anchors[i].line])
    if (mine && theirs) out[a.line] = out[a.line].replace(TASK, (_, head) => `${head}${theirs[2]}]`)
  })

  // New thread comments (not already in the source), right after the same block and its comments.
  const have = new Map<string, number>()
  for (const c of s.comments) have.set(s.lines[c.line].trim(), (have.get(s.lines[c.line].trim()) ?? 0) + 1)
  const added = new Map<number, string[]>()
  for (const c of t.comments) {
    const text = t.lines[c.line]
    const n = have.get(text.trim()) ?? 0
    if (n) have.set(text.trim(), n - 1)
    else added.set(c.anchor, [...(added.get(c.anchor) ?? []), text])
  }
  // From the end, so the line numbers before stay valid.
  for (const a of [...added.keys()].sort((x, y) => y - x)) {
    let at = a < 0 ? s.fmEnd + 1 : s.anchors[a].last + 1
    while (at < out.length && COMMENT_LINE.test(out[at])) at++
    out.splice(at, 0, ...added.get(a)!)
  }

  // `status` and `updated`, from the translation's frontmatter.
  if (s.fmEnd > 0 && t.fmEnd > 0) {
    for (const key of ['status', 'updated']) {
      const re = new RegExp(`^${key}:`)
      const theirs = t.lines.slice(1, t.fmEnd).find((l) => re.test(l))
      if (!theirs) continue
      const end = out.findIndex((l, j) => j > 0 && l.trimEnd() === '---')
      const at = out.slice(1, end).findIndex((l) => re.test(l))
      if (at >= 0) out[at + 1] = theirs
      else out.splice(end, 0, theirs)
    }
  }
  return out.join('\n')
}

/**
 * Write the answer given in the `lang` translation of proposal `rel` into the source. The pair is marked
 * in sync when nothing else (edited prose) is left to bring back. Returns the source before and after.
 */
export function carryAnswer(root: string, rel: string, lang: string): { before: string; after: string } {
  const file = safeResolve(root, rel)
  const before = fs.readFileSync(file, 'utf8')
  const after = carryAnswerText(before, fs.readFileSync(translationPath(root, lang, rel), 'utf8'))
  if (after !== before) fs.writeFileSync(file, after)
  const back = backPlan(root, rel, lang)
  if (!back.structural && !back.pending.length) markSynced(root, lang, rel)
  return { before, after }
}
