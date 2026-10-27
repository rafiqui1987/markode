import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightCode, tagHighlighter, tags as t } from '@lezer/highlight'
import { marked } from 'marked'
import { content } from './copy'
import { imageUrl, printMermaidSvg } from './widgets'

export type PaperSize = 'A4' | 'A3'
export type Orientation = 'portrait' | 'landscape'
/** `markode`: the visual view's colors, light theme; `simple`: plain, as on GitHub. */
export type PdfStyle = 'markode' | 'simple'

const BASE = `
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1f2328; font: 11pt/1.6 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.5em; break-after: avoid; }
body > :first-child { margin-top: 0; }
code, pre { font-family: 'JetBrains Mono', ui-monospace, 'Cascadia Code', Menlo, monospace; font-size: 0.88em; }
code { border-radius: 4px; padding: 0.1em 0.35em; }
pre { border-radius: 6px; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
pre code { background: none !important; color: inherit; padding: 0; font-size: 1em; }
blockquote { margin: 0 0 1em; padding: 0 1em; }
table { border-collapse: collapse; margin: 0 0 1em; }
th, td { padding: 5px 10px; text-align: left; }
tr { break-inside: avoid; }
img, svg { max-width: 100%; }
img { break-inside: avoid; }
.mermaid { text-align: center; margin: 1em 0; break-inside: avoid; }
hr { border: 0; margin: 1.5em 0; }
li > input[type=checkbox] { margin: 0 0.4em 0 -1.3em; }
ul:has(> li > input[type=checkbox]) { list-style: none; }
`

const SIMPLE = `
h1 { font-size: 2em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }
a { color: #0969da; text-decoration: none; }
code { background: #f2f4f7; }
pre { background: #f6f8fa; border: 1px solid #d0d7de; }
blockquote { color: #59636e; border-left: 4px solid #d0d7de; }
th, td { border: 1px solid #d0d7de; }
th { background: #f6f8fa; }
hr { border-top: 1px solid #d0d7de; }
`

/** The visual view (see the editor's highlight style and styles.css), on white paper. */
const MARKODE = `
body { color: var(--text); }
h1 { font-size: 1.9em; color: var(--md-h1); font-weight: 700; }
h2 { font-size: 1.45em; color: var(--md-h2); font-weight: 700; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
h3 { font-size: 1.2em; color: var(--md-h3); font-weight: 650; }
h4, h5, h6 { font-size: 1.05em; color: var(--md-h4); font-weight: 600; }
strong { color: var(--md-strong); }
em { color: var(--md-em); }
del { color: var(--muted); }
a { color: var(--md-link); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--md-link) 40%, transparent); text-underline-offset: 3px; }
code { background: var(--md-code-bg); color: var(--md-code); }
pre { background: var(--md-block-bg); border: 1px solid var(--border); color: var(--text); }
blockquote { color: var(--md-quote); font-style: italic; border-left: 3px solid var(--md-quote); padding-left: 12px; }
li::marker { color: var(--md-list); font-weight: 700; }
li > input[type=checkbox] { accent-color: var(--md-task-done); }
th, td { border: 1px solid var(--border); }
th { background: var(--md-table-head); color: var(--md-h2); font-weight: 600; }
hr { border-top: 1px solid var(--border); }
pre .k { color: var(--code-keyword); }
pre .s { color: var(--code-string); }
pre .n { color: var(--code-number); }
pre .c { color: var(--code-comment); font-style: italic; }
pre .f { color: var(--code-fn); }
pre .t { color: var(--code-type); }
pre .p { color: var(--code-prop); }
pre .o { color: var(--code-punct); }
`

/** The same code tags the editor colors, as short classes. */
const codeClasses = tagHighlighter([
  { tag: t.keyword, class: 'k' },
  { tag: [t.string, t.special(t.string)], class: 's' },
  { tag: [t.number, t.bool, t.null], class: 'n' },
  { tag: t.comment, class: 'c' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'f' },
  { tag: [t.typeName, t.className], class: 't' },
  { tag: [t.propertyName, t.attributeName], class: 'p' },
  { tag: [t.operator, t.punctuation], class: 'o' },
])

/** The light theme's color tokens, read from the app's stylesheet (whatever theme is on screen). */
function lightTokens() {
  const base: Record<string, string> = {}
  const light: Record<string, string> = {}
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule)) continue
      const sel = rule.selectorText.replace(/\s|["']/g, '')
      const into = sel === ':root' ? base : sel === ':root[data-resolved-theme=light]' ? light : null
      if (!into) continue
      for (const name of rule.style) if (name.startsWith('--')) into[name] = rule.style.getPropertyValue(name).trim()
    }
  }
  return { ...base, ...light }
}

async function highlight(code: Element) {
  const name = /language-(\S+)/.exec(code.className)?.[1]
  const desc = name && LanguageDescription.matchLanguageName(languages, name, true)
  if (!desc) return
  const text = code.textContent ?? ''
  const tree = (await desc.load()).language.parser.parse(text)
  const out = document.createDocumentFragment()
  highlightCode(
    text,
    tree,
    codeClasses,
    (piece, classes) => {
      if (!classes) return out.append(piece)
      const span = document.createElement('span')
      span.className = classes
      span.textContent = piece
      out.append(span)
    },
    () => out.append('\n'),
  )
  code.replaceChildren(out)
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`)

/**
 * Print a document to PDF through the browser's print dialog, with the paper already set:
 * diagrams drawn, without markode's notes (frontmatter, comments), always on a light page.
 */
export async function printPdf(md: string, docPath: string, size: PaperSize, orientation: Orientation, style: PdfStyle) {
  const tokens = style === 'markode' ? lightTokens() : null
  const html = await marked.parse(content(md, true), { gfm: true })
  const body = new DOMParser().parseFromString(html, 'text/html').body
  for (const code of body.querySelectorAll('pre > code')) {
    if (!code.classList.contains('language-mermaid')) {
      if (tokens) await highlight(code).catch(() => {})
      continue
    }
    const box = document.createElement('div')
    box.className = 'mermaid'
    try {
      box.innerHTML = await printMermaidSvg(code.textContent ?? '', tokens ?? undefined)
    } catch {
      continue
    }
    code.parentElement!.replaceWith(box)
  }
  for (const img of body.querySelectorAll('img')) img.src = imageUrl(img.getAttribute('src') ?? '', docPath)

  const vars = tokens ? `:root { ${Object.entries(tokens).map(([k, v]) => `${k}: ${v};`).join(' ')} }` : ''
  const css = `@page { size: ${size} ${orientation}; margin: 16mm; }${vars}${BASE}${tokens ? MARKODE : SIMPLE}`
  const title = docPath.split('/').pop()!.replace(/\.md$/i, '')
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.append(frame)
  const doc = frame.contentDocument!
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>${css}</style></head><body>${body.innerHTML}</body></html>`)
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
