import { marked } from 'marked'

/** Frontmatter and HTML comments (comment threads, choice markers) are markode's notes, not content. */
function content(md: string, fromStart: boolean) {
  const body = fromStart ? md.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '') : md
  return body.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n?/gm, '').replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * Copy Markdown to the clipboard as is, or as formatted text: HTML for apps that paste rich text
 * (Word, Docs, mail), with the Markdown as the plain-text fallback. `fromStart`: `md` starts the document.
 */
export async function copyMarkdown(md: string, formatted: boolean, fromStart: boolean) {
  if (!formatted) return navigator.clipboard.writeText(md)
  const text = content(md, fromStart)
  const html = await marked.parse(text, { gfm: true })
  await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
}
