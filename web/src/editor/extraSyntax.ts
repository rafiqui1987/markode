import { tags as t } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

const DOLLAR = 36
const BACKSLASH = 92
const BACKTICK = 96
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === -1
const isDigit = (c: number) => c >= 48 && c <= 57

/**
 * `$inline$` and `$$ display $$` math. Like Pandoc, inline math needs no space after the opening
 * `$` nor before the closing one, and the closing `$` can't be followed by a digit, so prices
 * like "$10 and $20" stay text. Also, math opening with a digit must close before any space
 * ("$2^n$" is math, "$5 and $x$" is not), and a `$` inside a code span never closes math. An unclosed `$$`
 * block ends at the first blank line.
 */
export const MathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: t.monospace },
    { name: 'BlockMath', block: true, style: t.monospace },
    { name: 'MathMark', style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      parse(cx, next, pos) {
        if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR || isSpace(cx.char(pos + 1))) return -1
        const number = isDigit(cx.char(pos + 1))
        for (let i = pos + 2; i < cx.end; i++) {
          const c = cx.char(i)
          if (number && isSpace(c)) return -1
          if (c === BACKSLASH) i++
          else if (c === BACKTICK) {
            const close = cx.slice(i + 1, cx.end).indexOf('`')
            if (close < 0) return -1
            i += close + 1
          } else if (c === DOLLAR && !isSpace(cx.char(i - 1)) && !isDigit(cx.char(i + 1)))
            return cx.addElement(cx.elt('InlineMath', pos, i + 1, [cx.elt('MathMark', pos, pos + 1), cx.elt('MathMark', i, i + 1)]))
        }
        return -1
      },
    },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'FencedCode',
      parse(cx, line) {
        if (!line.text.startsWith('$$', line.pos)) return false
        const from = cx.lineStart + line.pos
        let to = cx.lineStart + line.text.length
        const oneLine = /\S.*\$\$\s*$/.test(line.text.slice(line.pos + 2))
        if (oneLine) cx.nextLine()
        else
          while (cx.nextLine()) {
            if (!line.text.trim()) break
            to = cx.lineStart + line.text.length
            if (/\$\$\s*$/.test(line.text)) {
              cx.nextLine()
              break
            }
          }
        cx.addElement(cx.elt('BlockMath', from, to))
        return true
      },
      endLeaf: (_, line) => line.text.startsWith('$$', line.pos),
    },
  ],
}

/** `[^label]` footnote references; at the start of a line followed by `:` they mark a definition. */
export const Footnotes: MarkdownConfig = {
  defineNodes: [{ name: 'FootnoteRef', style: t.labelName }],
  parseInline: [
    {
      name: 'FootnoteRef',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== 91 || cx.char(pos + 1) !== 94) return -1
        for (let i = pos + 2; i < cx.end; i++) {
          const c = cx.char(i)
          if (c === 93) return i > pos + 2 ? cx.addElement(cx.elt('FootnoteRef', pos, i + 1)) : -1
          if (isSpace(c) || c === 91) return -1
        }
        return -1
      },
    },
  ],
}
