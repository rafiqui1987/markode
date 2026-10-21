import { tags as t } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

/** Parses a leading `---` YAML block so it isn't read as a setext heading / rule. */
export const Frontmatter: MarkdownConfig = {
  defineNodes: [{ name: 'Frontmatter', block: true, style: t.meta }],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false
        const from = cx.lineStart
        let to = from + line.text.length
        while (cx.nextLine()) {
          to = cx.lineStart + line.text.length
          if (/^(---|\.\.\.)\s*$/.test(line.text)) {
            cx.nextLine()
            break
          }
        }
        cx.addElement(cx.elt('Frontmatter', from, to))
        return true
      },
    },
  ],
}
