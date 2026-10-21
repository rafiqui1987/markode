import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches } from '@codemirror/search'
import { Annotation, Compartment, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { T } from '../i18n'
import { Footnotes, MathSyntax } from './extraSyntax'
import { Frontmatter } from './frontmatter'
import { commentAuthor } from './comments'
import { docPath, livePreview, translator } from './livePreview'
import { formatBar } from './formatBar'
import { pasteTable } from './pasteTable'
import { searchPanel } from './searchPanel'
import { slashMenu } from './slashMenu'
import { taskHint } from './taskHint'
import { setWidgetTranslate } from './widgets'

/** Token colors come from CSS variables so light/dark switch without rebuilding the editor. */
const highlight = HighlightStyle.define([
  { tag: t.heading1, color: 'var(--md-h1)', fontWeight: '700' },
  { tag: t.heading2, color: 'var(--md-h2)', fontWeight: '700' },
  { tag: t.heading3, color: 'var(--md-h3)', fontWeight: '650' },
  { tag: [t.heading4, t.heading5, t.heading6], color: 'var(--md-h4)', fontWeight: '600' },
  { tag: t.strong, color: 'var(--md-strong)', fontWeight: '700' },
  { tag: t.emphasis, color: 'var(--md-em)', fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: t.link, color: 'var(--md-link)' },
  { tag: t.url, color: 'var(--md-url)' },
  { tag: t.monospace, color: 'var(--md-code)' },
  { tag: t.quote, color: 'var(--md-quote)', fontStyle: 'italic' },
  { tag: t.meta, color: 'var(--md-fm)' },
  { tag: [t.processingInstruction, t.contentSeparator], color: 'var(--md-mark)' },
  { tag: t.labelName, color: 'var(--md-mark)' },
  // Code inside fenced blocks
  { tag: t.keyword, color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--code-number)' },
  { tag: t.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--code-fn)' },
  { tag: [t.typeName, t.className], color: 'var(--code-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--code-prop)' },
  { tag: [t.operator, t.punctuation], color: 'var(--code-punct)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--editor-font)', fontSize: 'var(--editor-size)', lineHeight: 'var(--editor-line)', padding: '16px 0 40vh' },
  // Side space is margin, not padding: CodeMirror draws full-line selections from the content box's
  // edge, so padding there made selections spill into the margins.
  '.cm-content': { padding: '0', flexGrow: '0', margin: '0 auto', width: 'calc(100% - 2 * var(--editor-pad))', maxWidth: 'var(--editor-max)', caretColor: 'var(--accent)' },
  // Without wrapping the content grows with its longest line instead.
  '.cm-content:not(.cm-lineWrapping)': { width: 'auto', minWidth: 'calc(100% - 2 * var(--editor-pad))', maxWidth: 'none', margin: '0 var(--editor-pad)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  // Above the text (the color is translucent): below it, opaque backgrounds such as code blocks hid the selection.
  '.cm-selectionLayer': { zIndex: '1 !important' },
  '.cm-tooltip.cm-slash-menu, .cm-tooltip.cm-task-hint, .cm-tooltip.cm-format-bar': { border: '1px solid var(--border)', backgroundColor: 'var(--panel-2)' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--border)' },
})

/** Holds `EditorView.lineWrapping`, so the setting can change without rebuilding the editor. */
export const wrapping = new Compartment()

/** `author` signs new comments; null when proposals and comments are off for the project. */
export function editorExtensions(translate: T, path: string, wrap: boolean, author: string | null, onChange: (text: string) => void): Extension[] {
  setWidgetTranslate(translate)
  return [
    history(),
    drawSelection(),
    searchPanel(),
    highlightSelectionMatches(),
    wrapping.of(wrap ? EditorView.lineWrapping : []),
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [Frontmatter, MathSyntax, Footnotes] }),
    syntaxHighlighting(highlight),
    theme,
    docPath.of(path),
    translator.of(translate),
    commentAuthor.of(author),
    livePreview,
    slashMenu(translate),
    taskHint(translate),
    formatBar(translate),
    pasteTable(translate),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && u.transactions.some((tr) => !tr.annotation(externalChange))) onChange(u.state.doc.toString())
    }),
  ]
}

/** Marks transactions that load content from disk, so they don't trigger a save. */
export const externalChange = Annotation.define<boolean>()
