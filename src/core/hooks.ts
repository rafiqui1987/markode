import fs from 'node:fs'
import path from 'node:path'
import { assertInside, PKG_ROOT } from './config.js'

/**
 * Claude Code hooks that tell the agent about the user's edits and comments while it works: a session
 * start marks what is old news, then every prompt and every tool call reports what is new (silent
 * otherwise, so they add nothing to the context). Other agents run `markode changes` from the skill.
 */
const EVENTS = {
  SessionStart: 'changes --start',
  UserPromptSubmit: 'changes --hook UserPromptSubmit',
  PostToolUse: 'changes --hook PostToolUse',
} as const

/** Personal: each user decides whether their agent gets the hooks. `settings.json` held them before 0.3. */
const LOCAL = 'settings.local.json'
const SHARED = 'settings.json'
const settingsFile = (root: string, name = LOCAL) => path.join(root, '.claude', name)

/** `markode` when it is installed, otherwise run through npx. */
function cli() {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  if (dirs.some((d) => ['markode', 'markode.cmd'].some((f) => fs.existsSync(path.join(d, f))))) return 'markode'
  const name = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).name
  return `npx -y --prefer-offline ${name}`
}

const isOurs = (entry: any) => Array.isArray(entry?.hooks) && entry.hooks.some((h: any) => typeof h?.command === 'string' && / changes --(start|hook)\b/.test(h.command))

function readSettings(root: string, name = LOCAL): Record<string, any> | null {
  const file = settingsFile(root, name)
  if (!fs.existsSync(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function hasClaudeHooks(root: string) {
  return [LOCAL, SHARED].some((name) => {
    const hooks = readSettings(root, name)?.hooks ?? {}
    return Object.keys(EVENTS).every((e) => (hooks[e] ?? []).some(isOurs))
  })
}

/** Write `settings` with markode's hooks (or without them), keeping everything else; empty lists go. */
function writeHooks(root: string, name: string, add: boolean): boolean {
  const settings = readSettings(root, name)
  if (!settings) return false
  if (!add && !fs.existsSync(settingsFile(root, name))) return true
  const base = cli()
  settings.hooks ??= {}
  for (const [event, args] of Object.entries(EVENTS)) {
    const list: any[] = (settings.hooks[event] ?? []).filter((e: any) => !isOurs(e))
    if (add) list.push({ hooks: [{ type: 'command', command: `${base} ${args}` }] })
    if (list.length) settings.hooks[event] = list
    else delete settings.hooks[event]
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks
  // A file that only held markode's hooks goes with them.
  assertInside(settingsFile(root, name))
  if (!Object.keys(settings).length) return fs.rmSync(settingsFile(root, name), { force: true }), true
  fs.mkdirSync(path.dirname(settingsFile(root, name)), { recursive: true })
  fs.writeFileSync(settingsFile(root, name), JSON.stringify(settings, null, 2) + '\n')
  return true
}

/** Add the hooks to `.claude/settings.local.json` (moving them out of `settings.json`). False when it can't be parsed. */
export function installClaudeHooks(root: string): boolean {
  if (!writeHooks(root, LOCAL, true)) return false
  writeHooks(root, SHARED, false)
  return true
}

/** Remove markode's hooks from both settings files; the user's own hooks stay. */
export function removeClaudeHooks(root: string) {
  writeHooks(root, LOCAL, false)
  writeHooks(root, SHARED, false)
}
