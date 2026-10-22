import fs from 'node:fs'
import path from 'node:path'

/**
 * What kind of project a folder is, so the setup asks only what matters for it and the main doc tells
 * the agent which docs that kind needs. Detected from files; unclear when there are no signals or they
 * contradict each other.
 */
export type ProjectKind = 'app' | 'library' | 'mobile' | 'data' | 'infra'

export const KIND_LABEL: Record<ProjectKind, string> = { app: 'App', library: 'Library', mobile: 'Mobile', data: 'Data / ML', infra: 'Infrastructure' }
export const KIND_HINT: Record<ProjectKind, string> = {
  app: 'web, API, CLI, desktop',
  library: 'a package other code imports',
  mobile: 'iOS, Android, Flutter, React Native',
  data: 'notebooks, datasets, models',
  infra: 'Terraform, Pulumi, Helm, Kubernetes',
}

export interface KindGuess {
  kind: ProjectKind
  unclear: boolean
  /** Why: one short reason per signal found. */
  signals: string[]
}

/** The answers that shape what a project's docs hold. */
export interface Profile {
  kind: ProjectKind
  published?: boolean
  platforms?: string[]
  dataLocation?: string
  experiments?: Experiments
  environments?: string
}

export type Experiments = 'docs' | 'mlflow' | 'wandb' | 'dvc'
export const EXPERIMENTS_LABEL: Record<Experiments, string> = {
  docs: '`docs/experiments.md` (one entry per run: goal, data, result)',
  mlflow: 'MLflow',
  wandb: 'Weights & Biases',
  dvc: 'DVC',
}

const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'target', '.git', '.venv', 'venv'])

const names = (abs: string) => {
  try {
    return fs.readdirSync(abs, { withFileTypes: true })
  } catch {
    return []
  }
}

/** The first file (or folder) whose name matches, up to `depth` levels down. */
function find(abs: string, re: RegExp, depth: number): string | null {
  for (const e of names(abs)) {
    if (re.test(e.name)) return path.join(abs, e.name)
    if (e.isDirectory() && depth > 0 && !SKIP.has(e.name) && !e.name.startsWith('.')) {
      const hit = find(path.join(abs, e.name), re, depth - 1)
      if (hit) return hit
    }
  }
  return null
}

const read = (abs: string) => {
  try {
    return fs.readFileSync(abs, 'utf8')
  } catch {
    return ''
  }
}
const readJson = (abs: string): Record<string, any> | null => {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch {
    return null
  }
}

const APP_DEPS = ['next', 'nuxt', 'vite', 'react-scripts', '@angular/core', '@sveltejs/kit', 'astro', 'express', 'fastify', '@nestjs/core', 'koa', 'hono', 'electron']

export function guessKind(dir: string): KindGuess {
  const found: Partial<Record<ProjectKind, string[]>> = {}
  const add = (kind: ProjectKind, why: string) => (found[kind] ??= []).push(why)
  const has = (name: string) => fs.existsSync(path.join(dir, name))
  const pkg = readJson(path.join(dir, 'package.json'))
  const deps: Record<string, string> = { ...pkg?.dependencies, ...pkg?.devDependencies }

  if (has('pubspec.yaml')) add('mobile', 'Flutter (pubspec.yaml)')
  if (deps['react-native'] || deps.expo) add('mobile', 'React Native')
  if (has('android') && has('ios')) add('mobile', 'android/ and ios/')
  else if (find(dir, /\.xcodeproj$/, 1)) add('mobile', 'Xcode project')

  if (find(dir, /\.ipynb$/, 2)) add('data', 'notebooks')
  if (has('dvc.yaml') || has('MLproject')) add('data', has('dvc.yaml') ? 'dvc.yaml' : 'MLproject')

  if (find(dir, /\.tf$/, 2)) add('infra', 'Terraform')
  if (has('Pulumi.yaml')) add('infra', 'Pulumi')
  if (find(dir, /^(Chart|kustomization)\.ya?ml$/, 2)) add('infra', 'Helm / Kustomize')

  if (pkg && !pkg.private && !pkg.bin && (pkg.main || pkg.exports || pkg.module)) add('library', 'package.json exports')
  if (/^\[lib\]/m.test(read(path.join(dir, 'Cargo.toml')))) add('library', 'Cargo [lib]')

  if (pkg?.bin) add('app', 'CLI (bin)')
  const framework = APP_DEPS.find((d) => deps[d])
  if (framework) add('app', framework)
  if (has('manage.py')) add('app', 'Django')
  if (has('main.go')) add('app', 'main.go')
  if (has('Dockerfile')) add('app', 'Dockerfile')

  const kinds = Object.keys(found) as ProjectKind[]
  const signals = kinds.flatMap((k) => found[k]!)
  // Mobile, data and infrastructure are more specific than "app" (a mobile app has react deps, a
  // Terraform repo may have a Dockerfile); two specific kinds, or a library that is also an app, are unclear.
  const specific = kinds.filter((k) => k !== 'app')
  if (!kinds.length) return { kind: 'app', unclear: true, signals }
  if (specific.length === 1) return { kind: specific[0], unclear: false, signals }
  if (!specific.length) return { kind: 'app', unclear: false, signals }
  return { kind: specific.find((k) => k !== 'library') ?? specific[0], unclear: true, signals }
}

/** Where a repository of services keeps its contracts (proto, OpenAPI), if it looks like one. */
export function findContracts(root: string): string | null {
  const hit = find(root, /(\.proto|^openapi.*\.ya?ml|^openapi.*\.json|^asyncapi.*\.ya?ml)$/i, 3)
  if (!hit) return null
  const dir = path.relative(root, path.dirname(hit)).split(path.sep).join('/')
  return dir ? `${dir}/` : path.basename(hit)
}

export const looksLikeMicroservices = (root: string, projects: number) =>
  projects >= 2 && (!!findContracts(root) || !!find(root, /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/, 0))

/** Defaults for a kind's questions, from what the folder already has. */
export function detectProfile(dir: string, kind: ProjectKind): Profile {
  const has = (name: string) => fs.existsSync(path.join(dir, name))
  const pkg = readJson(path.join(dir, 'package.json'))
  if (kind === 'library') return { kind, published: !!pkg?.publishConfig || (!!pkg?.name && !pkg.private) }
  if (kind === 'mobile') {
    const platforms = ['ios', 'android', 'web'].filter((p) => has(p))
    return { kind, platforms: platforms.length ? platforms : ['ios', 'android'] }
  }
  if (kind === 'data') {
    const experiments: Experiments = has('dvc.yaml') ? 'dvc' : has('mlruns') ? 'mlflow' : has('wandb') ? 'wandb' : 'docs'
    const data = ['data', 'datasets'].find(has)
    return { kind, dataLocation: data ? `${data}/` : '', experiments }
  }
  if (kind === 'infra') {
    const envDir = ['envs', 'environments', 'env'].find((d) => has(d))
    const envs = envDir
      ? names(path.join(dir, envDir))
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : []
    return { kind, environments: envs.length ? envs.join(', ') : 'dev, staging, prod' }
  }
  return { kind }
}

/** What the agent should know about this kind of project: which docs it needs and where they go. */
export function kindGuidance(p: Profile): string | null {
  switch (p.kind) {
    case 'library':
      return `Library${p.published ? ', published' : ''}: record public API and versioning decisions in \`docs/architecture/api.md\`; phases only if the user plans milestones.${p.published ? ' One `CHANGELOG.md` entry per release.' : ''}`
    case 'mobile':
      return `Mobile app (${(p.platforms ?? []).join(', ') || 'platforms not set'}): release and store decisions in \`docs/architecture/releases.md\`.`
    case 'data':
      return `Data / ML: each dataset (source, location${p.dataLocation ? `: \`${p.dataLocation}\`` : ''}, schema) in \`docs/architecture/data.md\`; experiments tracked in ${EXPERIMENTS_LABEL[p.experiments ?? 'docs']}.`
    case 'infra':
      return `Infrastructure (environments: ${p.environments || 'dev, staging, prod'}): one runbook per operation in \`docs/runbooks/\`; changing an environment is a task.`
    default:
      return null
  }
}

export const contractsGuidance = (contracts: string) =>
  `Microservices: contracts (APIs, events) live in \`${contracts}\`. Changing one is a shared decision (\`docs/architecture/contracts.md\`) and every consumer gets a task.`

/** Docs the project already had before the setup: the agent updates them instead of creating new ones. */
export function existingDocs(root: string): string[] {
  const docs = path.join(root, 'docs')
  const out: string[] = []
  for (const e of names(docs)) {
    if (e.name.startsWith('.') || e.name === 'tasks' || e.name === 'proposals') continue
    if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(`docs/${e.name}`)
    else if (e.isDirectory() && find(path.join(docs, e.name), /\.md$/i, 2)) out.push(`docs/${e.name}/`)
  }
  for (const adr of ['adr', 'decisions']) if (find(path.join(root, adr), /\.md$/i, 1)) out.push(`${adr}/`)
  return out.sort()
}
