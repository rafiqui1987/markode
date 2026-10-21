import { Check, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type DocSummary, type GitStatus, type Progress, type Rule, type SddSummary } from '../api'
import type { T, TKey } from '../i18n'

const STATUSES = ['pending', 'in-progress', 'done', 'blocked']

export function StatusChip({ status, t }: { status: string | null; t: T }) {
  if (!status) return null
  const known = STATUSES.includes(status)
  return <span className={`status-chip s-${status}`}>{known ? t(`status.${status}` as TKey) : status}</span>
}

// ------------------------------------------------------------ dashboard

const pct = (p: Progress) => (p.total ? Math.round((p.done / p.total) * 100) : 0)

function ProgressBar({ tasks, t }: { tasks: Progress; t: T }) {
  return (
    <>
      <div className="progress">
        <div style={{ width: `${pct(tasks)}%` }} />
      </div>
      <div className="meta">{tasks.total ? `${tasks.done}/${tasks.total} ${t('dash.tasks')} · ${pct(tasks)}%` : t('dash.noTasks')}</div>
    </>
  )
}

/** Which artifacts of a change or feature exist yet: present ones are highlighted. */
function Artifacts({ items }: { items: [string, boolean][] }) {
  return (
    <div className="artifacts">
      {items.map(([name, on]) => (
        <span key={name} className={on ? 'on' : ''}>
          {name}
        </span>
      ))}
    </div>
  )
}

function OpenSpecSection({ data, t, onOpen }: { data: NonNullable<SddSummary['openspec']>; t: T; onOpen: (p: string) => void }) {
  return (
    <>
      <h2>OpenSpec · {t('dash.activeChanges')}</h2>
      {data.changes.length ? (
        <div className="phases">
          {data.changes.map((c) => (
            <div className="card" key={c.id} onClick={() => onOpen(c.path)}>
              <div className="meta">
                <span className="num">{c.id}</span>
              </div>
              <div className="title">{c.title}</div>
              <Artifacts items={[['proposal', c.artifacts.proposal], ['design', c.artifacts.design], ['tasks', c.artifacts.tasks], [c.artifacts.specs ? `specs ×${c.artifacts.specs}` : 'specs', c.artifacts.specs > 0]]} />
              <ProgressBar tasks={c.tasks} t={t} />
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">{t('dash.noChanges')}</p>
      )}
      <h2>OpenSpec · {t('dash.specs')}</h2>
      {data.specs.length ? (
        <div className="chips">
          {data.specs.map((s) => (
            <button key={s.id} className="chip" onClick={() => onOpen(s.path)}>
              {s.id}
            </button>
          ))}
        </div>
      ) : (
        <p className="hint">{t('dash.noSpecs')}</p>
      )}
      {!!data.archived.length && (
        <>
          <h2>OpenSpec · {t('dash.archived')}</h2>
          <div className="chips">
            {data.archived.map((a) => (
              <button key={a.id} className="chip" disabled={!a.path} onClick={() => onOpen(a.path)}>
                {a.id}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function SpecKitSection({ data, t, onOpen }: { data: NonNullable<SddSummary['speckit']>; t: T; onOpen: (p: string) => void }) {
  return (
    <>
      <h2>Spec Kit · {t('dash.constitution')}</h2>
      {data.constitution ? (
        <div className="row">
          <button className="chip" onClick={() => onOpen(data.constitution!.path)}>
            {data.constitution.path}
          </button>
          <StatusChip status={data.constitution.filled ? 'done' : 'pending'} t={t} />
          {!data.constitution.filled && <span className="hint">{t('dash.constitutionTodo')}</span>}
        </div>
      ) : (
        <p className="hint">{t('dash.constitutionTodo')}</p>
      )}
      <h2>Spec Kit · {t('dash.features')}</h2>
      {data.features.length ? (
        <div className="phases">
          {data.features.map((f) => (
            <div className="card" key={f.id} onClick={() => onOpen(f.path)}>
              <div className="meta">
                <span className="num">{f.id}</span>
              </div>
              <div className="title">{f.title}</div>
              <Artifacts items={[['spec', f.artifacts.spec], ['plan', f.artifacts.plan], ['tasks', f.artifacts.tasks]]} />
              <ProgressBar tasks={f.tasks} t={t} />
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">{t('dash.noFeatures')}</p>
      )}
    </>
  )
}

export function Dashboard({ t, tick, onOpen }: { t: T; tick: number; onOpen: (p: string) => void }) {
  const [docs, setDocs] = useState<DocSummary[]>([])
  const [sdd, setSdd] = useState<SddSummary>({})
  useEffect(() => {
    api.dashboard().then((d) => {
      setDocs(d.docs)
      setSdd(d.sdd)
    })
  }, [tick])

  const phases = docs.filter((d) => d.type === 'phase').sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || a.path.localeCompare(b.path))
  const others = docs.filter((d) => d.type !== 'phase')
  const types = [...new Set(others.map((d) => d.type ?? ''))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))

  return (
    <div className="page">
      {sdd.openspec && <OpenSpecSection data={sdd.openspec} t={t} onOpen={onOpen} />}
      {sdd.speckit && <SpecKitSection data={sdd.speckit} t={t} onOpen={onOpen} />}
      {(phases.length > 0 || (!sdd.openspec && !sdd.speckit)) && <h2>{t('dash.phases')}</h2>}
      {phases.length ? (
        <div className="phases">
          {phases.map((p) => {
            const pct = p.tasks.total ? Math.round((p.tasks.done / p.tasks.total) * 100) : p.status === 'done' ? 100 : 0
            return (
              <div className="card" key={p.path} onClick={() => onOpen(p.path)}>
                <div className="meta">
                  <span className="num">{p.phase !== null ? `#${p.phase}` : '—'}</span>
                  <StatusChip status={p.status} t={t} />
                </div>
                <div className="title">{p.title}</div>
                <div className="progress">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <div className="meta">
                  {p.tasks.done}/{p.tasks.total} {t('dash.tasks')} · {pct}%{p.updated && <span style={{ marginLeft: 'auto' }}>{p.updated}</span>}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        !sdd.openspec && !sdd.speckit && <p style={{ color: 'var(--muted)' }}>{t('dash.noPhases')}</p>
      )}

      {types.map((type) => (
        <section key={type}>
          <h2>{type ? (['tasks', 'rules', 'architecture', 'decision', 'note'].includes(type) ? t(`type.${type}` as TKey) : type) : t('dash.untyped')}</h2>
          <table className="doc-table">
            <tbody>
              {others
                .filter((d) => (d.type ?? '') === type)
                .map((d) => (
                  <tr className="click" key={d.path} onClick={() => onOpen(d.path)}>
                    <td style={{ fontWeight: 500 }}>{d.title}</td>
                    <td className="path">{d.path}</td>
                    <td>
                      <StatusChip status={d.status} t={t} />
                    </td>
                    <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{d.tasks.total ? `${d.tasks.done}/${d.tasks.total} ${t('dash.tasks')}` : ''}</td>
                    <td style={{ color: 'var(--faint)', whiteSpace: 'nowrap' }}>{d.updated ?? ''}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}

// ------------------------------------------------------------ changes

interface DiffLine {
  kind: 'add' | 'del' | 'ctx'
  text: string
}

/** Group diff hunks under the Markdown heading they belong to. */
function parseDiff(diff: string): { section: string; lines: DiffLine[] }[] {
  const groups: { section: string; lines: DiffLine[] }[] = []
  let current: { section: string; lines: DiffLine[] } | null = null
  let lastHeading = ''
  for (const raw of diff.split('\n')) {
    if (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(raw)) continue
    if (raw.startsWith('@@')) {
      const ctx = raw.replace(/^@@[^@]*@@\s?/, '')
      if (/^#{1,6}\s/.test(ctx)) lastHeading = ctx
      current = null
      continue
    }
    const kind = raw[0] === '+' ? 'add' : raw[0] === '-' ? 'del' : 'ctx'
    const text = raw.slice(1)
    const heading = /^#{1,6}\s+.*/.exec(text)?.[0]
    if (heading && kind !== 'del') lastHeading = heading
    if (!current || (heading && current.section !== heading && kind !== 'del')) {
      current = { section: lastHeading.replace(/^#+\s*/, '') || '—', lines: [] }
      groups.push(current)
    }
    current.lines.push({ kind, text })
  }
  // Drop sections that are only context.
  return groups.filter((g) => g.lines.some((l) => l.kind !== 'ctx'))
}

export function Changes({ t, git, enabled, tick }: { t: T; git: Record<string, GitStatus>; enabled: boolean; tick: number }) {
  const files = Object.keys(git).sort()
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const current = selected && files.includes(selected) ? selected : files[0] ?? null

  useEffect(() => {
    if (current) api.diff(current).then((d) => setDiff(d.diff))
    else setDiff('')
  }, [current, tick])

  if (!enabled) return <div className="empty">{t('changes.noGit')}</div>
  if (!files.length) return <div className="empty">{t('changes.none')}</div>

  return (
    <div className="changes">
      <div className="changes-list">
        {files.map((f) => (
          <div key={f} className={`node${f === current ? ' selected' : ''}`} onClick={() => setSelected(f)} title={f}>
            <span className="name">{f}</span>
            <span className={`badge git-${git[f]}`}>{git[f]}</span>
          </div>
        ))}
      </div>
      <div className="diff">
        {parseDiff(diff).map((g, i) => (
          <div key={i}>
            <div className="section">
              {t('changes.section')}: {g.section}
            </div>
            {g.lines.map((l, j) => (
              <div key={j} className={`ln ${l.kind}`}>
                {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}
                {l.text}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ rules

interface Draft extends Rule {
  dirty?: boolean
  isNew?: boolean
}

export function Rules({ t }: { t: T }) {
  const [rules, setRules] = useState<Draft[]>([])
  const [applied, setApplied] = useState<string[]>([])
  const [savedApplied, setSavedApplied] = useState<string[]>([])
  const [mainDoc, setMainDoc] = useState<string | null>(null)

  const load = () =>
    api.rules().then((r) => {
      setRules(r.rules)
      setApplied(r.applied)
      setSavedApplied(r.applied)
      setMainDoc(r.mainDoc)
    })
  useEffect(() => {
    load()
  }, [])

  const update = (i: number, patch: Partial<Draft>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, dirty: true } : r)))
  const appliedChanged = applied.join() !== savedApplied.join()

  return (
    <div className="page">
      <div className="rules">
        <div className="row">
          <h2 style={{ margin: 0, flex: 1 }}>{t('rules.title')}</h2>
          <button className="btn" onClick={() => setRules((rs) => [{ id: '', title: '', body: '- ', dirty: true, isNew: true }, ...rs])}>
            <Plus size={14} /> {t('rules.new')}
          </button>
          {mainDoc && (
            <button
              className={`btn${appliedChanged ? ' primary' : ''}`}
              onClick={async () => {
                const order = rules.map((r) => r.id).filter((id) => applied.includes(id))
                await api.applyRules(order)
                setSavedApplied(order)
                setApplied(order)
              }}
            >
              <Check size={14} /> {t('rules.apply', { doc: mainDoc })}
            </button>
          )}
        </div>
        <p className="sub">{mainDoc ? t('rules.subtitle', { doc: mainDoc }) : t('rules.noMain')}</p>
        {rules.map((r, i) => (
          <div className="rule" key={r.id || `new-${i}`}>
            <input
              type="checkbox"
              disabled={!r.id || !mainDoc}
              checked={applied.includes(r.id)}
              onChange={(e) => setApplied((a) => (e.target.checked ? [...a, r.id] : a.filter((x) => x !== r.id)))}
            />
            <input className="rule-title" value={r.title} placeholder={t('rules.titlePh')} onChange={(e) => update(i, { title: e.target.value })} />
            <div className="row">
              {r.dirty && (
                <button
                  className="btn primary"
                  disabled={!r.title.trim()}
                  onClick={async () => {
                    const saved = await api.saveRule({ id: r.id || undefined, title: r.title, body: r.body })
                    setRules((rs) => rs.map((x, j) => (j === i ? saved : x)))
                  }}
                >
                  <Save size={14} /> {t('rules.save')}
                </button>
              )}
              <button
                className="btn danger"
                title={t('rules.delete')}
                onClick={async () => {
                  if (r.id) await api.deleteRule(r.id)
                  setRules((rs) => rs.filter((_, j) => j !== i))
                  setApplied((a) => a.filter((x) => x !== r.id))
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <textarea value={r.body} placeholder={t('rules.bodyPh')} onChange={(e) => update(i, { body: e.target.value })} rows={Math.max(2, r.body.split('\n').length)} />
          </div>
        ))}
      </div>
    </div>
  )
}
