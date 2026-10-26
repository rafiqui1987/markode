import { marked } from 'marked'
import { content } from './copy'
import { imageUrl, printMermaidSvg } from './widgets'

export type PaperSize = 'A4' | 'A3'
export type Orientation = 'portrait' | 'landscape'

const STYLE = `
body { margin: 0; color: #1f2328; font: 11pt/1.6 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.5em; break-after: avoid; }
h1 { font-size: 2em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }
body > :first-child { margin-top: 0; }
a { color: #0969da; text-decoration: none; }
code, pre { font-family: 'JetBrains Mono', ui-monospace, 'Cascadia Code', Menlo, monospace; font-size: 0.88em; }
code { background: #f2f4f7; border-radius: 4px; padding: 0.1em 0.35em; }
pre { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
pre code { background: none; padding: 0; }
blockquote { margin: 0 0 1em; padding: 0 1em; color: #59636e; border-left: 4px solid #d0d7de; }
table { border-collapse: collapse; margin: 0 0 1em; break-inside: auto; }
th, td { border: 1px solid #d0d7de; padding: 5px 10px; text-align: left; }
th { background: #f6f8fa; }
tr { break-inside: avoid; }
img, svg { max-width: 100%; }
img { break-inside: avoid; }
.mermaid { text-align: center; margin: 1em 0; break-inside: avoid; }
hr { border: 0; border-top: 1px solid #d0d7de; margin: 1.5em 0; }
li > input[type=checkbox] { margin: 0 0.4em 0 -1.3em; }
ul:has(> li > input[type=checkbox]) { list-style: none; }
`

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`)

/**
 * Print a document to PDF through the browser's print dialog, with the paper already set:
 * rendered as on GitHub (light, diagrams drawn), without markode's notes (frontmatter, comments).
 */
export async function printPdf(md: string, docPath: string, size: PaperSize, orientation: Orientation) {
  const html = await marked.parse(content(md, true), { gfm: true })
  const body = new DOMParser().parseFromString(html, 'text/html').body
  for (const code of body.querySelectorAll('pre > code.language-mermaid')) {
    const box = document.createElement('div')
    box.className = 'mermaid'
    try {
      box.innerHTML = await printMermaidSvg(code.textContent ?? '')
    } catch {
      continue
    }
    code.parentElement!.replaceWith(box)
  }
  for (const img of body.querySelectorAll('img')) img.src = imageUrl(img.getAttribute('src') ?? '', docPath)

  const title = docPath.split('/').pop()!.replace(/\.md$/i, '')
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.append(frame)
  const doc = frame.contentDocument!
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>@page { size: ${size} ${orientation}; margin: 16mm; }${STYLE}</style></head><body>${body.innerHTML}</body></html>`)
  doc.close()
  await Promise.all([...doc.images].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))))
  await doc.fonts?.ready

  // The browser names the PDF after the page title.
  const appTitle = document.title
  document.title = title
  const done = () => {
    document.title = appTitle
    frame.remove()
  }
  frame.contentWindow!.addEventListener('afterprint', () => setTimeout(done))
  frame.contentWindow!.focus()
  frame.contentWindow!.print()
}
