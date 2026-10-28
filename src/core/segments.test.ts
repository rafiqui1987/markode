import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { test } from 'node:test'
import { join, restore, segmentsOf, split } from './segments.js'

/** A fake engine: upper-cases the prose, leaves the placeholders as they are. */
const upper = (md: string) => join(split(md), (s) => s.text.toUpperCase())
const texts = (md: string) => segmentsOf(split(md)).map((s) => s.text)

test('every .md file in the repo comes back byte for byte when nothing is translated', () => {
  const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  assert.ok(files.length > 5)
  for (const f of files) {
    const md = fs.readFileSync(f, 'utf8')
    assert.equal(join(split(md), () => undefined), md, f)
    assert.equal(join(split(md), (s) => s.text), md, f)
  }
})

test('every .md file keeps its code blocks and comments after translating', () => {
  const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  for (const f of files) {
    const md = fs.readFileSync(f, 'utf8')
    const out = upper(md)
    const fences = (s: string) => s.match(/^\s*```[\s\S]*?^\s*```/gm) ?? []
    assert.deepEqual(fences(out), fences(md), f)
    const comments = (s: string) => s.match(/<!--[\s\S]*?-->/g) ?? []
    assert.deepEqual(comments(out), comments(md), f)
  }
})

test('frontmatter: only prose values are translated', () => {
  const md = '---\ntype: proposal\nstatus: open\ntitle: Login flow\ndescription: "Use the: gateway"\n---\n\nBody text here.\n'
  assert.equal(upper(md), '---\ntype: proposal\nstatus: open\ntitle: LOGIN FLOW\ndescription: "USE THE: GATEWAY"\n---\n\nBODY TEXT HERE.\n')
  assert.equal(join(split('---\ntitle: a\n---\n'), () => 'Paso 1: hecho'), '---\ntitle: "Paso 1: hecho"\n---\n')
})

test('headings, lists and task boxes keep their markers', () => {
  const md = '## Setup ##\n\n- [x] Install it\n  1. First step\n> Quoted line\n'
  assert.equal(upper(md), '## SETUP ##\n\n- [x] INSTALL IT\n  1. FIRST STEP\n> QUOTED LINE\n')
})

test('inline code, link targets, HTML, URLs and comments are protected', () => {
  assert.deepEqual(texts('Run `pnpm dev` and see [the spec](docs/SPEC.md "Spec") or https://x.dev <br> <!-- c -->\n'), [
    'Run {0} and see [the spec{1} or {2} {3} {4}',
  ])
  assert.equal(upper('Run `pnpm dev`, see [docs](a/b.md).\n'), 'RUN `pnpm dev`, SEE [DOCS](a/b.md).\n')
})

test('code, mermaid, tree and math blocks are kept', () => {
  const md = 'Intro text.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n~~~\nraw text\n~~~\n\n$$\nx = y\n$$\n'
  assert.deepEqual(texts(md), ['Intro text.'])
})

test('tables: each cell is a segment, the separator and pipes are kept', () => {
  const md = '| Setting | Values |\n|---|:-:|\n| Font size | `12` px |\n'
  assert.deepEqual(texts(md), ['Setting', 'Values', 'Font size', '{0} px'])
  assert.equal(upper(md), '| SETTING | VALUES |\n|---|:-:|\n| FONT SIZE | `12` PX |\n')
})

test('a wrapped paragraph is one segment and is re-wrapped at the same width and indent', () => {
  const md = '- First line of an item that\n  goes on in the next line.\n\nNext.\n'
  assert.deepEqual(texts(md), ['First line of an item that goes on in the next line.', 'Next.'])
  const out = join(split(md), (s) => (s.text === 'Next.' ? undefined : 'Primera línea de un elemento que sigue en la línea siguiente y es más larga'))
  assert.equal(out, '- Primera línea de un\n  elemento que sigue en la\n  línea siguiente y es más\n  larga\n\nNext.\n')
})

test('a hard break ends the segment', () => {
  assert.deepEqual(texts('Line one  \nLine two\\\nLine three\n'), ['Line one', 'Line two', 'Line three'])
})

test('a comment block and a callout header are kept', () => {
  const md = '- [x] A: gateway\n  <!-- comment by R, on "gateway": why? -->\n> [!NOTE]\n> Read this.\n'
  assert.deepEqual(texts(md), ['A: gateway', 'Read this.'])
})

test('CRLF files keep CRLF', () => {
  assert.equal(upper('# Title\r\n\r\nText.\r\n'), '# TITLE\r\n\r\nTEXT.\r\n')
})

test('restore: dropped or unknown placeholders are reported, dropped spans are not lost', () => {
  const seg = segmentsOf(split('See `a` and `b`.\n'))[0]
  assert.deepEqual(restore(seg, 'Mira {1} y {0}.'), { text: 'Mira `b` y `a`.', ok: true })
  assert.deepEqual(restore(seg, 'Mira {0}.'), { text: 'Mira `a`. `b`', ok: false })
  assert.equal(restore(seg, 'Mira { 0 } y {1} {7}.').ok, false)
})

test('the cache key ignores what the spans hold', () => {
  assert.equal(texts('See `a`.\n')[0], texts('See `b`.\n')[0])
})
