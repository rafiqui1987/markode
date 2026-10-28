import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileStatus, translationPath } from './i18n.js'
import { apply, backAccept, backPlan, backPropose, type Pending, plan, pruneCache, queue, readGlossary, writeGlossary } from './translation.js'

/** A fake engine: upper-cases the text and records what it was asked. */
function fakeEngine(edit: (p: Pending) => string = (p) => p.text.toUpperCase()) {
  const asked: Pending[] = []
  const engine = {
    async translate(items: Pending[]) {
      asked.push(...items)
      return items.map(edit)
    },
  }
  return { engine, asked }
}

/** What the markode tab does (web/src/translate.ts): plan, engine, apply, one retry for lost placeholders. */
async function translateFile(root: string, rel: string, _from: string, lang: string, engine: ReturnType<typeof fakeEngine>['engine']) {
  const status = fileStatus(root, lang, rel)
  if (status !== 'missing' && status !== 'outdated') return { skipped: status }
  const pending = plan(root, rel, lang)
  const texts = await engine.translate(pending)
  const res = apply(root, rel, lang, Object.fromEntries(pending.map((p, i) => [p.key, texts[i]])))
  if (!res.rejected.length) return res
  const retry = pending.filter((p) => res.rejected.includes(p.key))
  const again = await engine.translate(retry)
  return apply(root, rel, lang, Object.fromEntries(retry.map((p, i) => [p.key, again[i]])), true)
}

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markode-tr-'))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  return root
}
const read = (root: string, lang: string, rel: string) => fs.readFileSync(translationPath(root, lang, rel), 'utf8')

test('only segments not in the cache go to the engine', async () => {
  const root = project({ 'a.md': '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n' })
  const first = fakeEngine()
  assert.deepEqual(await translateFile(root, 'a.md', 'en', 'es', first.engine), { missing: 0, rejected: [], written: true })
  assert.equal(first.asked.length, 3)
  assert.equal(read(root, 'es', 'a.md'), '# TITLE\n\nFIRST PARAGRAPH.\n\nSECOND PARAGRAPH.\n')
  assert.equal(fileStatus(root, 'es', 'a.md'), 'synced')

  fs.writeFileSync(path.join(root, 'a.md'), '# Title\n\nFirst paragraph, edited.\n\nSecond paragraph.\n')
  const second = fakeEngine()
  await translateFile(root, 'a.md', 'en', 'es', second.engine)
  assert.deepEqual(second.asked.map((p) => p.text), ['First paragraph, edited.'])
  assert.equal(read(root, 'es', 'a.md'), '# TITLE\n\nFIRST PARAGRAPH, EDITED.\n\nSECOND PARAGRAPH.\n')
})

test('the same text in two files is translated once', async () => {
  const root = project({ 'a.md': 'Shared line.\n', 'b.md': 'Shared line.\n' })
  const e = fakeEngine()
  await translateFile(root, 'a.md', 'en', 'es', e.engine)
  await translateFile(root, 'b.md', 'en', 'es', e.engine)
  assert.equal(e.asked.length, 1)
  assert.equal(read(root, 'es', 'b.md'), 'SHARED LINE.\n')
})

test('glossary: kept terms come back untouched, fixed terms are passed to the engine', async () => {
  const root = project({ 'a.md': 'Open markode and write a proposal.\n' })
  writeGlossary(root, { keep: ['markode'], terms: { es: { proposal: 'propuesta' } } })
  const e = fakeEngine()
  await translateFile(root, 'a.md', 'en', 'es', e.engine)
  assert.deepEqual(e.asked[0], { key: e.asked[0].key, text: 'Open {0} and write a proposal.', terms: { proposal: 'propuesta' } })
  assert.equal(read(root, 'es', 'a.md'), 'OPEN markode AND WRITE A PROPOSAL.\n')
})

test('a glossary change only invalidates the segments it touches', async () => {
  const root = project({ 'a.md': 'Use the skill.\n\nNothing else.\n' })
  await translateFile(root, 'a.md', 'en', 'es', fakeEngine().engine)
  writeGlossary(root, { keep: ['skill'], terms: {} })
  assert.deepEqual(plan(root, 'a.md', 'es').map((p) => p.text), ['Use the {0}.'])
})

test('a lost placeholder is retried once, then left in the source language', async () => {
  const root = project({ 'a.md': 'Run `pnpm dev` now.\n\nPlain text.\n' })
  let calls = 0
  const e = fakeEngine((p) => (p.text.includes('{0}') && calls++ < 1 ? 'EJECUTA AHORA.' : p.text.toUpperCase()))
  const res = await translateFile(root, 'a.md', 'en', 'es', e.engine)
  assert.deepEqual(res, { missing: 0, rejected: [], written: true })
  assert.equal(read(root, 'es', 'a.md'), 'RUN `pnpm dev` NOW.\n\nPLAIN TEXT.\n')

  const root2 = project({ 'a.md': 'Run `pnpm dev` now.\n\nPlain text.\n' })
  const bad = fakeEngine((p) => (p.text.includes('{0}') ? 'EJECUTA AHORA.' : p.text.toUpperCase()))
  const res2 = await translateFile(root2, 'a.md', 'en', 'es', bad.engine)
  assert.equal('missing' in res2 && res2.missing, 1)
  assert.equal(read(root2, 'es', 'a.md'), 'Run `pnpm dev` now.\n\nPLAIN TEXT.\n')
  assert.equal(fileStatus(root2, 'es', 'a.md'), 'outdated')
})

test('a translation the user edited is never overwritten', async () => {
  const root = project({ 'a.md': 'Hello there.\n' })
  await translateFile(root, 'a.md', 'en', 'es', fakeEngine().engine)
  fs.writeFileSync(translationPath(root, 'es', 'a.md'), 'Hola, editado.\n')
  fs.writeFileSync(path.join(root, 'a.md'), 'Hello there, again.\n')
  const e = fakeEngine()
  assert.deepEqual(await translateFile(root, 'a.md', 'en', 'es', e.engine), { skipped: 'conflict' })
  assert.equal(e.asked.length, 0)
  assert.equal(read(root, 'es', 'a.md'), 'Hola, editado.\n')
})

test('pruneCache drops segments no file uses', async () => {
  const root = project({ 'a.md': 'One.\n\nTwo.\n' })
  await translateFile(root, 'a.md', 'en', 'es', fakeEngine().engine)
  fs.writeFileSync(path.join(root, 'a.md'), 'One.\n')
  pruneCache(root, 'es', ['a.md'])
  const cache = JSON.parse(fs.readFileSync(path.join(root, '.markode', 'cache', 'es.json'), 'utf8'))
  assert.deepEqual(Object.values(cache), ['ONE.'])
})

test('a glossary file with wrong fields is read safely', () => {
  const root = project({ '.markode/glossary.json': '{"keep": ["ok", 3, ""], "terms": {"es": {"a": "b", "c": 1}, "fr": []}}' })
  assert.deepEqual(readGlossary(root), { keep: ['ok'], terms: { es: { a: 'b' } } })
})

test('an edited translation goes back to the source, only the edited segment', async () => {
  const src = '# Title\n\nRun `pnpm dev` first.\n\n```sh\nkeep me\n```\n'
  const root = project({ 'a.md': src })
  await translateFile(root, 'a.md', 'en', 'es', fakeEngine().engine)
  fs.writeFileSync(translationPath(root, 'es', 'a.md'), read(root, 'es', 'a.md').replace('RUN `pnpm dev` FIRST.', 'EJECUTA `pnpm dev` ANTES.'))
  assert.equal(fileStatus(root, 'es', 'a.md'), 'pending-sync')

  const { pending, structural } = backPlan(root, 'a.md', 'es')
  assert.equal(structural, false)
  assert.deepEqual(pending.map((p) => p.text), ['EJECUTA {0} ANTES.'])
  const results = { [pending[0].key]: 'Run {0} before anything else.' }
  const proposal = backPropose(root, 'a.md', 'es', results)
  assert.deepEqual(proposal.changes, [{ before: 'Run `pnpm dev` first.', after: 'Run `pnpm dev` before anything else.' }])
  assert.equal(proposal.source, src.replace('first.', 'before anything else.'))
  assert.equal(fs.readFileSync(path.join(root, 'a.md'), 'utf8'), src)

  backAccept(root, 'a.md', 'es', results)
  assert.equal(fs.readFileSync(path.join(root, 'a.md'), 'utf8'), proposal.source)
  assert.equal(fileStatus(root, 'es', 'a.md'), 'synced')
  // The user's wording is now the cached translation: nothing to translate again.
  assert.deepEqual(plan(root, 'a.md', 'es'), [])
})

test('an edited translation with a new paragraph is left to the agent', async () => {
  const root = project({ 'a.md': 'One.\n' })
  await translateFile(root, 'a.md', 'en', 'es', fakeEngine().engine)
  fs.writeFileSync(translationPath(root, 'es', 'a.md'), 'UNO.\n\nDOS.\n')
  assert.deepEqual(backPlan(root, 'a.md', 'es'), { pending: [], structural: true })
})

test('queue lists missing and outdated translations only', async () => {
  const root = project({ 'a.md': 'One.\n', 'b.md': 'Two.\n' })
  await translateFile(root, 'a.md', 'en', 'es', fakeEngine().engine)
  assert.deepEqual(queue(root, ['es', 'fr']), [
    { path: 'b.md', lang: 'es' },
    { path: 'a.md', lang: 'fr' },
    { path: 'b.md', lang: 'fr' },
  ])
})
