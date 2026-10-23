#!/usr/bin/env node
/**
 * Try markode's setup on a throwaway project, as a new user would: a fresh copy of a sample project in the
 * system's temp folder and an empty ~/.markode, so the first-run question shows up. Runs the built CLI
 * (`pnpm build` first) and, when it exits, lists every file markode created or changed.
 *
 *   pnpm sandbox [sample] [markode args…]      e.g. pnpm sandbox monorepo, pnpm sandbox es init --profile full
 *   --keep-home   use a shared sandbox ~/.markode, to see what a second project does with saved defaults
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CLI = path.join(ROOT, 'dist', 'cli.js')
const BASE = path.join(os.tmpdir(), 'markode-sandbox')

const prose = (lang) =>
  lang === 'es'
    ? 'Este proyecto es una aplicación web para el equipo. La documentación explica cómo se organizan las tareas, cuando se debe revisar cada cambio y por qué se toman las decisiones de la arquitectura con el equipo de producto.\n'
    : 'This project is a web application for the team. The docs explain how the tasks are organized, when each change should be reviewed and why the architecture decisions are taken with the product team.\n'

/** Sample projects: path → content. */
const SAMPLES = {
  empty: { 'README.md': '# Empty\n' },
  single: { 'README.md': `# Shop\n\n${prose('en')}`, 'package.json': '{ "name": "shop", "dependencies": { "react": "^19.0.0" } }\n' },
  es: { 'README.md': `# Tienda\n\n${prose('es')}`, 'docs/guia.md': `# Guía\n\n${prose('es')}`, 'package.json': '{ "name": "tienda" }\n' },
  agents: { 'AGENTS.md': `# Agents\n\n${prose('en')}`, 'package.json': '{ "name": "api", "dependencies": { "express": "^5.0.0" } }\n' },
  claude: { 'CLAUDE.md': `# Claude\n\n${prose('en')}`, '.claude/settings.json': '{ "permissions": { "allow": ["Bash(pnpm test)"] } }\n' },
  monorepo: {
    'README.md': `# Monorepo\n\n${prose('en')}`,
    'package.json': '{ "name": "root", "private": true }\n',
    'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
    'apps/web/package.json': '{ "name": "web", "dependencies": { "react": "^19.0.0" } }\n',
    'apps/api/package.json': '{ "name": "api", "dependencies": { "express": "^5.0.0" } }\n',
  },
  openspec: { 'README.md': `# Specs\n\n${prose('en')}`, 'openspec/project.md': '# Project\n', 'openspec/specs/auth/spec.md': '# Auth\n' },
}

const args = process.argv.slice(2)
const keepHome = args.includes('--keep-home')
const rest = args.filter((a) => a !== '--keep-home')
const sample = rest[0] && !rest[0].startsWith('-') && SAMPLES[rest[0]] ? rest.shift() : 'single'

if (rest[0] === 'list' || args.includes('--help')) {
  console.log(`Samples: ${Object.keys(SAMPLES).join(', ')}\nUsage: pnpm sandbox [sample] [--keep-home] [markode args…]`)
  process.exit(0)
}
if (!fs.existsSync(CLI)) {
  console.error('Run `pnpm build` first: the sandbox uses dist/cli.js, as an installed markode would.')
  process.exit(1)
}

const dir = path.join(BASE, `${sample}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`)
for (const [rel, text] of Object.entries(SAMPLES[sample])) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), text)
}
// A git repo with the sample committed: `git status` then shows exactly what markode did.
const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
git('init', '-q')
git('add', '-A')
git('-c', 'user.name=sandbox', '-c', 'user.email=sandbox@example.com', 'commit', '-qm', 'sample')

const home = keepHome ? path.join(BASE, '.home') : path.join(dir, '..', `.home-${path.basename(dir)}`)
console.log(`\n  sample   ${sample}\n  project  ${dir}\n  ~/.markode  ${home}${keepHome ? ' (shared)' : ' (empty: first run)'}\n`)
spawnSync(process.execPath, [CLI, ...rest], { cwd: dir, stdio: 'inherit', env: { ...process.env, MARKODE_HOME: home, MARKODE_ROOT: dir } })

// Ignored files count too: .markode/ ignores itself and Claude Code's settings.local.json usually is.
const status = execFileSync('git', ['status', '--porcelain', '--ignored', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' }).trimEnd()
const label = { '??': 'new      ', ' M': 'changed  ', '!!': 'personal ' }
const lines = status.split('\n').filter(Boolean).map((l) => `    ${label[l.slice(0, 2)] ?? l.slice(0, 2)} ${l.slice(3)}`)
console.log(`\n  What markode wrote in the project (personal = ignored by git):\n${lines.join('\n') || '    nothing'}\n`)
console.log(`  See a change: git -C ${dir} diff <file>   ·   Clean up: rm -rf ${BASE}\n`)
