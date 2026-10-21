import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { watch } from 'chokidar'
import open from 'open'
import pc from 'picocolors'
import { WebSocketServer } from 'ws'
import { isLang, isLangCode, type Lang, langName, readConfig, readSettings, safeResolve, stateDir, toPosix, WEB_DIR, writeConfig, writeSettings } from '../core/config.js'
import { summarize } from '../core/dashboard.js'
import { gitDiff, gitStatuses, isGitRepo } from '../core/git.js'
import { allStatuses, fileStatus, foreignFiles, keepLanguage, translationPath } from '../core/i18n.js'
import { appliedRuleIds, applyRulesToFile, deleteRule, listRules, projectSourceLang, saveRule } from '../core/rules.js'
import { scanTree, setIgnored, watchSkips } from '../core/scan.js'
import { activateProposals, authorName, deactivateProposals, proposalsState } from '../core/proposals.js'
import { sddPrefixes, summarizeSdd } from '../core/sdd.js'
import { getSkill, installSkill, listSkills, PROJECT_TARGETS, type ProjectTarget, projectTargets, setSkillTags, skillSources } from '../core/skills.js'

interface Options {
  root: string
  port: number
  open: boolean
}

/** Images a document may reference; served from the project by /api/asset. */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  let data = ''
  for await (const chunk of req) data += chunk
  if (!data) return {}
  // Browsers only send JSON cross-site after a CORS preflight, which this server never grants.
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Expected application/json')
  return JSON.parse(data)
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Only this app may talk to the server: the Host must be local (blocks DNS rebinding) and an Origin,
 * when sent, must be this same host (blocks other web pages, which could otherwise create files).
 */
function isLocalRequest(req: http.IncomingMessage): boolean {
  const host = req.headers.host ?? ''
  try {
    if (!LOCAL_HOSTS.has(new URL(`http://${host}`).hostname)) return false
    return !req.headers.origin || new URL(req.headers.origin).host === host
  } catch {
    return false
  }
}

export async function startServer({ root, port, open: openBrowser }: Options) {
  const config = () => readConfig(root) ?? { mainDoc: null, langs: [] as string[] }
  const sourceLang = () => projectSourceLang(root, readConfig(root)?.mainDoc)
  /** The translation language a request asks for, or null when it wants the source files. */
  const viewLang = (value: unknown): string | null => (isLangCode(value) && value !== sourceLang() && config().langs.includes(value) ? value : null)

  const mdPath = (rel: unknown) => {
    if (typeof rel !== 'string' || !rel.toLowerCase().endsWith('.md')) throw new HttpError(400, 'Expected a .md path')
    safeResolve(root, rel)
    return rel
  }

  /** A file or folder inside the project that may be deleted (never the project root itself). */
  const deletable = (rel: unknown) => {
    if (typeof rel !== 'string' || !rel.trim()) throw new HttpError(400, 'Expected a path')
    const abs = safeResolve(root, rel)
    if (abs === root) throw new HttpError(400, 'Refusing to delete the project root')
    if (!fs.existsSync(abs)) throw new HttpError(404, 'Not found')
    return abs
  }

  const routes: Record<string, (url: URL, body: any) => unknown> = {
    'GET /api/info': () => {
      const c = config()
      return {
        name: path.basename(root),
        mainDoc: c.mainDoc ?? null,
        sourceLang: sourceLang(),
        langs: c.langs.filter((l) => l !== sourceLang()),
        langNames: Object.fromEntries(c.langs.map((l) => [l, langName(l, c)])),
        git: isGitRepo(root),
        proposals: proposalsState(root),
        author: authorName(root),
      }
    },
    'PUT /api/config': (_, body) => {
      const c = config()
      if (Array.isArray(body.langs)) c.langs = body.langs.filter(isLangCode)
      if (isLang(body.sourceLang) && body.sourceLang !== sourceLang()) {
        if (!c.mainDoc) throw new HttpError(400, 'No main document configured; run `mdrules init`')
        applyRulesToFile(path.join(root, c.mainDoc), undefined, body.sourceLang)
      }
      // Kept as chosen; the source language is filtered out wherever it is read.
      writeConfig(root, c)
      return { ...c, langs: c.langs.filter((l) => l !== sourceLang()) }
    },
    'PUT /api/proposals': (_, body) => {
      if (body.active) activateProposals(root, body.layout === 'structured' ? 'structured' : 'general', config().mainDoc)
      else deactivateProposals(root, config().mainDoc)
      return proposalsState(root)
    },
    'GET /api/settings': () => readSettings(),
    'PUT /api/settings': (_, body) => writeSettings(body),
    'GET /api/tree': (url) => {
      const l = viewLang(url.searchParams.get('lang'))
      const sync = l ? Object.fromEntries(allStatuses(root, l).map((e) => [e.path, e.status])) : {}
      const foreign = Object.fromEntries(foreignFiles(root, sourceLang()).map((f) => [f.path, f.detected]))
      return { tree: scanTree(root), git: gitStatuses(root), sync, foreign }
    },
    'POST /api/keep-language': (_, body) => ({ lang: keepLanguage(root, mdPath(body.path)) }),
    'GET /api/file': (url) => {
      const rel = mdPath(url.searchParams.get('path'))
      const l = viewLang(url.searchParams.get('lang'))
      const source = fs.readFileSync(safeResolve(root, rel), 'utf8')
      if (l) {
        const tPath = translationPath(root, l, rel)
        if (fs.existsSync(tPath)) return { path: rel, content: fs.readFileSync(tPath, 'utf8'), target: 'translation', status: fileStatus(root, l, rel) }
        return { path: rel, content: source, target: 'source', status: 'missing' }
      }
      return { path: rel, content: source, target: 'source', status: null }
    },
    'PUT /api/file': (_, body) => {
      const rel = mdPath(body.path)
      const l = viewLang(body.lang)
      const file = body.target === 'translation' && l ? translationPath(root, l, rel) : safeResolve(root, rel)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, String(body.content ?? ''))
      return { ok: true, status: l ? fileStatus(root, l, rel) : null }
    },
    'POST /api/file': (_, body) => {
      const rel = mdPath(body.path)
      const file = safeResolve(root, rel)
      if (fs.existsSync(file)) throw new HttpError(409, 'File already exists')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const title = path.basename(rel, '.md').replace(/^\d+[-_]/, '').replace(/[-_]/g, ' ')
      fs.writeFileSync(file, `# ${title.charAt(0).toUpperCase() + title.slice(1)}\n\n`)
      return { ok: true, path: rel }
    },
    // Only a mkdir: nothing else is touched, so editors that have the project open are unaffected.
    'POST /api/dir': (_, body) => {
      if (typeof body.path !== 'string' || !body.path.trim()) throw new HttpError(400, 'Expected a path')
      const dir = safeResolve(root, body.path)
      if (dir === root) throw new HttpError(400, 'Expected a path')
      if (fs.existsSync(dir)) throw new HttpError(409, 'A file or folder with that name already exists')
      fs.mkdirSync(dir, { recursive: true })
      return { ok: true, path: toPosix(path.relative(root, dir)) }
    },
    'GET /api/delete-preview': (url) => {
      const abs = deletable(url.searchParams.get('path'))
      if (!fs.statSync(abs).isDirectory()) return { kind: 'file', files: 1, md: 1 }
      const files = fs.readdirSync(abs, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
      return { kind: 'dir', files: files.length, md: files.filter((e) => e.name.toLowerCase().endsWith('.md')).length }
    },
    'DELETE /api/path': (url) => {
      const rel = toPosix(path.relative(root, deletable(url.searchParams.get('path'))))
      fs.rmSync(safeResolve(root, rel), { recursive: true })
      // Their translations would be orphaned.
      for (const l of config().langs) fs.rmSync(translationPath(root, l, rel), { recursive: true, force: true })
      return { ok: true }
    },
    'POST /api/ignore': (_, body) => {
      safeResolve(root, body.path)
      setIgnored(root, body.path, body.kind === 'dir' ? 'dir' : 'file', !!body.ignored)
      return { ok: true }
    },
    'GET /api/diff': (url) => ({ diff: gitDiff(root, mdPath(url.searchParams.get('path'))) }),
    'GET /api/dashboard': () => {
      const sdd = summarizeSdd(root)
      const shown = sddPrefixes(sdd)
      return { docs: summarize(root).filter((d) => !shown.some((p) => d.path.startsWith(p))), sdd }
    },
    'GET /api/rules': () => {
      const mainDoc = readConfig(root)?.mainDoc
      const text = mainDoc && fs.existsSync(path.join(root, mainDoc)) ? fs.readFileSync(path.join(root, mainDoc), 'utf8') : ''
      return { rules: listRules(), applied: appliedRuleIds(text), mainDoc: mainDoc ?? null }
    },
    'PUT /api/rules': (_, body) => saveRule(body),
    'DELETE /api/rules': (url) => {
      deleteRule(url.searchParams.get('id') ?? '')
      return { ok: true }
    },
    // Global skills: reads and writes are limited to SKILL.md of discovered skill folders.
    'GET /api/skills': () => ({ skills: listSkills(root), sources: skillSources(), targets: projectTargets(root) }),
    'PUT /api/skills/tags': (_, body) => {
      if (typeof body.name !== 'string' || !Array.isArray(body.tags)) throw new HttpError(400, 'Expected name and tags')
      return { tags: setSkillTags(body.name, body.tags.map(String)) }
    },
    'GET /api/skills/file': (url) => {
      const skill = getSkill(root, url.searchParams.get('key'))
      return { path: skill.key, content: fs.readFileSync(path.join(skill.key, 'SKILL.md'), 'utf8'), target: 'source', status: null }
    },
    'PUT /api/skills/file': (_, body) => {
      const skill = getSkill(root, body.key)
      if (skill.managed) throw new HttpError(403, 'This skill is managed by the app that installed it')
      fs.writeFileSync(path.join(skill.key, 'SKILL.md'), String(body.content ?? ''))
      return { ok: true, status: null }
    },
    'POST /api/skills/install': (_, body) => {
      const targets = (Array.isArray(body.targets) ? body.targets : []).filter((t: unknown): t is ProjectTarget => typeof t === 'string' && t in PROJECT_TARGETS)
      if (!targets.length) throw new HttpError(400, 'Expected at least one target')
      const result = installSkill(root, getSkill(root, body.key), targets, !!body.overwrite)
      if (result.conflict) throw new HttpError(409, result.conflict.join(', '))
      return result
    },
    'POST /api/rules/apply': (_, body) => {
      const mainDoc = readConfig(root)?.mainDoc
      if (!mainDoc) throw new HttpError(400, 'No main document configured; run `mdrules init`')
      applyRulesToFile(path.join(root, mainDoc), body.ids ?? [])
      return { ok: true }
    },
  }

  const server = http.createServer(async (req, res) => {
    if (!isLocalRequest(req)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = routes[`${req.method} ${url.pathname}`]
    if (route) {
      try {
        const result = await route(url, req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req))
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
      } catch (err) {
        const status = err instanceof HttpError ? err.status : (err as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (err as Error).message }))
      }
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/asset') return serveAsset(url.searchParams.get('path') ?? '', res)
    serveStatic(url.pathname, res)
  })

  /** An image inside the project, for previews; anything else (or outside the project) is a 404. */
  function serveAsset(rel: string, res: http.ServerResponse) {
    let file: string
    try {
      file = safeResolve(root, rel)
    } catch {
      res.writeHead(404).end()
      return
    }
    const type = IMAGE_MIME[path.extname(file).toLowerCase()]
    if (!type || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
    fs.createReadStream(file).pipe(res)
  }

  // Listen before attaching the WebSocket server: it re-emits EADDRINUSE and would crash the port fallback.
  const actualPort = await listen(server, port)
  const wss = new WebSocketServer({ server, path: '/ws', verifyClient: ({ req }: { req: http.IncomingMessage }) => isLocalRequest(req) })
  const broadcast = (msg: object) => {
    const data = JSON.stringify(msg)
    for (const client of wss.clients) client.send(data)
  }

  const skips = watchSkips(root)
  watch(root, {
    ignoreInitial: true,
    // Unreadable folders (e.g. caches owned by another user) are skipped instead of failing.
    ignorePermissionErrors: true,
    ignored: (p, stats) => {
      const rel = toPosix(path.relative(root, p))
      // .mdrules is skipped by the scan, but translations and sync state live there.
      if (rel === '.mdrules') return false
      if (rel.startsWith('.mdrules/')) return !rel.startsWith('.mdrules/i18n') && rel !== '.mdrules/state.json' && rel !== '.mdrules/config.json'
      return skips(rel, stats ? stats.isDirectory() : undefined)
    },
  })
    // Without a listener a watch error crashes the server; live updates for that path are just lost.
    .on('error', (err) => console.warn(pc.yellow(`  file watcher: ${(err as Error).message}`)))
    .on('all', (event, file) => {
      const abs = path.resolve(file)
      if (!abs.endsWith('.md') && !abs.endsWith('.json') && !abs.endsWith('.mdrulesignore') && event !== 'addDir' && event !== 'unlinkDir') return
      let rel = toPosix(path.relative(root, abs))
      const i18n = toPosix(path.relative(root, path.join(stateDir(root), 'i18n')))
      if (rel.startsWith(i18n + '/')) rel = rel.split('/').slice(3).join('/') // .mdrules/i18n/<lang>/<path>
      broadcast({ type: 'fs', event, path: rel })
    })

  const url = `http://localhost:${actualPort}`
  console.log(`\n  ${pc.bold('mdrules')} ${pc.dim('→')} ${pc.cyan(url)}  ${pc.dim(root)}\n`)
  if (!fs.existsSync(WEB_DIR)) console.log(pc.yellow('  Web UI not built: run `pnpm build`, or `pnpm dev` and open http://localhost:4320\n'))
  else if (openBrowser) open(url).catch(() => {})
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') resolve(listen(server, port + 1))
      else reject(err)
    })
    server.listen(port, '127.0.0.1', () => resolve(port))
  })
}

function serveStatic(pathname: string, res: http.ServerResponse) {
  let file = path.join(WEB_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(WEB_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIR, 'index.html')
  if (!fs.existsSync(file)) {
    res.writeHead(404).end('Web UI not built. Run `pnpm build`.')
    return
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}
