import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PKG_ROOT } from './config.js'

/**
 * `markode update`: install the version just published, without waiting. pnpm (and npm with
 * `min-release-age`) hold back versions younger than a day, and `npx --prefer-offline` keeps the cached
 * one; asking the registry for the exact version and turning the minimum age off for this one install
 * skips both.
 */
const PKG = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as { name: string; version: string }
export const CURRENT_VERSION = PKG.version

export type Installer = 'pnpm' | 'npm' | 'npx'

/** How this copy of markode was installed, from where it runs. */
export function installer(): Installer | null {
  const dir = PKG_ROOT.split(path.sep).join('/')
  if (dir.includes('/_npx/')) return 'npx'
  if (!dir.includes('/node_modules/')) return null // a clone of the repository
  return dir.includes('/pnpm/') || dir.includes('/.pnpm/') ? 'pnpm' : 'npm'
}

/** The version under the `latest` tag, straight from the registry (no cache, no minimum age). */
export async function latestVersion(): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${PKG.name}/latest`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`The npm registry answered ${res.status}`)
  return ((await res.json()) as { version: string }).version
}

/** a > b for plain x.y.z versions. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10))
  const pb = b.split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

/** The command that installs `version` globally with `via`, minimum release age off. */
export function installCommand(via: 'pnpm' | 'npm', version: string): string[] {
  const spec = `${PKG.name}@${version}`
  return via === 'pnpm'
    ? ['pnpm', 'add', '-g', spec, '--config.minimum-release-age=0']
    : ['npm', 'install', '-g', spec, '--min-release-age=0', '--prefer-online']
}

/** Run the install in this terminal; true when it worked. */
export function runInstall(cmd: string[]): boolean {
  return spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0
}
