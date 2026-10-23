import { execFileSync } from 'node:child_process'
import os from 'node:os'

export type GitStatus = 'M' | 'A' | 'D' | 'U'

/**
 * Run git on a project markode may not trust. It runs from a neutral folder with `-C` (on Windows a bare
 * `git` is looked up in the current folder first, where a repository could ship its own `git.exe`), and
 * with the settings of the repository's own `.git/config` that would run commands turned off.
 */
export function runGit(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=off', ...args], {
    cwd: os.homedir(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 32 * 1024 * 1024,
  })
}

function git(root: string, args: string[]): string | null {
  try {
    return runGit(root, args)
  } catch (err: any) {
    // `git diff --no-index` exits 1 when files differ; its stdout is still valid.
    return typeof err?.stdout === 'string' && err.stdout ? err.stdout : null
  }
}

export const isGitRepo = (root: string) => git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true'

/** Changed .md files, keyed by path relative to `root`. */
export function gitStatuses(root: string): Record<string, GitStatus> {
  const prefix = git(root, ['rev-parse', '--show-prefix'])?.trim() ?? ''
  const out = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'])
  const result: Record<string, GitStatus> = {}
  if (!out) return result
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    let file = entry.slice(3)
    if (code[0] === 'R' || code[0] === 'C') i++ // the original path follows; skip it
    if (!file.toLowerCase().endsWith('.md')) continue
    if (prefix && file.startsWith(prefix)) file = file.slice(prefix.length)
    if (file.startsWith('.markode/')) continue // translations and state are never project changes
    result[file] = code === '??' ? 'U' : code.includes('D') ? 'D' : code.includes('A') ? 'A' : 'M'
  }
  return result
}

/** Unified diff of a file against HEAD (or the whole file when untracked). */
export function gitDiff(root: string, rel: string): string {
  const status = gitStatuses(root)[rel]
  // No external diff tools or text conversions: both are commands a repository's config can name.
  const diff = ['diff', '--no-ext-diff', '--no-textconv']
  if (status === 'U') return git(root, [...diff, '--no-index', '--', '/dev/null', rel]) ?? ''
  const hasHead = git(root, ['rev-parse', '--verify', 'HEAD']) !== null
  return git(root, hasHead ? [...diff, 'HEAD', '--', rel] : [...diff, '--cached', '--', rel]) ?? ''
}
