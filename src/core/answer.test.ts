import assert from 'node:assert/strict'
import { test } from 'node:test'
import { carryAnswerText } from './answer.js'

const SOURCE = `---
type: proposal
status: open
updated: 2026-10-20
---

# Proposal: login

## Context

The login needs a decision, and this paragraph
wraps over two lines.

## Your choice

<!-- choose: one -->
- [ ] A: gateway validates
- [ ] B: each service validates
  <!-- comment by Ana, 2026-10-20: Older note. -->

\`\`\`text
- [ ] not a task, code
\`\`\`

| Option | Cost |
|---|---|
| A | low |
`

// The same proposal translated (wrapped differently), then answered by the user.
const ANSWERED = `---
type: proposal
status: answered
updated: 2026-10-29
---

# Propuesta: login

## Contexto

El login necesita una decisión, y este párrafo ocupa dos líneas en el original y tres
aquí porque la traducción
es más larga.
<!-- comment by Rafael, 2026-10-29: ¿Y el móvil? -->

## Tu elección

<!-- choose: one -->
- [x] A: el gateway valida
  <!-- comment by Rafael, 2026-10-29, on "gateway": ¿Y si se cae? -->
- [ ] B: cada servicio valida
  <!-- comment by Ana, 2026-10-20: Older note. -->
  <!-- reply by Rafael, 2026-10-29: Ya no aplica. -->

\`\`\`text
- [x] not a task, code
\`\`\`

| Opción | Coste |
|---|---|
| A | bajo |
`

test('ticks, status/updated and new comments go to the source; its prose stays', () => {
  const out = carryAnswerText(SOURCE, ANSWERED)
  assert.equal(
    out,
    `---
type: proposal
status: answered
updated: 2026-10-29
---

# Proposal: login

## Context

The login needs a decision, and this paragraph
wraps over two lines.
<!-- comment by Rafael, 2026-10-29: ¿Y el móvil? -->

## Your choice

<!-- choose: one -->
- [x] A: gateway validates
  <!-- comment by Rafael, 2026-10-29, on "gateway": ¿Y si se cae? -->
- [ ] B: each service validates
  <!-- comment by Ana, 2026-10-20: Older note. -->
  <!-- reply by Rafael, 2026-10-29: Ya no aplica. -->

\`\`\`text
- [ ] not a task, code
\`\`\`

| Option | Cost |
|---|---|
| A | low |
`,
  )
})

test('answering twice adds nothing twice', () => {
  const once = carryAnswerText(SOURCE, ANSWERED)
  assert.equal(carryAnswerText(once, ANSWERED), once)
})

test('a translation whose structure changed is refused', () => {
  assert.throws(() => carryAnswerText(SOURCE, ANSWERED.replace('## Tu elección', 'Un párrafo nuevo.\n\n## Tu elección')), /structure/)
})
