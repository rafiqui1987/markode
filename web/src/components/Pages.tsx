import { Check, MessageSquareText, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type DocSummary, type GitStatus, type Progress, type Rule, type SddSummary } from '../api'
import type { T, TKey } from '../i18n'

const STATUSES = ['pending', 'in-progress', 'done', 'blocked']

export function StatusChip({ status, t }: { status: string | null; t: T }) {
  if (!status) return null
  const known = STATUSES.includes(status)
  return <span className={`status-chip s-${status}`}>{known ? t(`status.${status}` as TKey) : status}</span>
}

// ------------------------------------------------------------ proposals

/** Above a proposal: what it waits for, and the button that sends the answer back to the AI. */
export function ProposalBanner({ status, copied, listening, affects, t, onSend, onOpen }: { status: string | null; copied: boolean; listening: boolean; affects: string[]; t: T; onSend: () => void; onOpen: (p: string) => void }) {
  const changes = affects.length > 0 && (
    <div className="banner proposal affects">
      {t('proposal.affects')}
      {affects.map((p) => (
        <button key={p} className="link" onClick={() => onOpen(p)}>
          {p}
        </button>
      ))}
    </div>
  )
  if (status === 'applied') return <div className="banner proposal applied">{t('proposal.applied')}</div>
  if (status === 'answered')
    return (
      <>
        <div className="banner proposal answered">
          <Check size={14} /> {listening ? t('proposal.listening') : copied ? t('proposal.copied') : t('proposal.answered')}
        </div>
        {changes}
      </>
    )
  return (
    <>
      <div className="banner proposal open">
        <MessageSquareText size={14} /> {t('proposal.open')}
        <button className="btn primary" onClick={onSend}>
          <Send size={13} /> {t('proposal.send')}
        </button>
      </div>
      {changes}
    </>
  )
}

const PROPOSAL_ORDER = ['open', 'answered', 'applied']

function Proposals({ docs, t, onOpen }: { docs: DocSummary[]; t: T; onOpen: (p: string) => void }) {
  const sorted = [...docs].sort((a, b) => PROPOSAL_ORDER.indexOf(a.status ?? 'open') - PROPOSAL_ORDER.indexOf(b.status ?? 'open') || (b.updated ?? '').localeCompare(a.updated ?? ''))
  const waiting = docs.filter((d) => (d.status ?? 'open') === 'open').length
  return (
    <section>
      <h2>
        {t('dash.proposals')} {waiting > 0 && <span className="pill warn">{t('dash.proposalsWaiting', { n: waiting })}</span>}
      </h2>
      <table className="doc-table">
        <tbody>
          {sorted.map((d) => (
            <tr className="click" key={d.path} onClick={() => onOpen(d.path)}>
              <td style={{ fontWeight: 500 }}>{d.title.replace(/^proposal:\s*/i, '')}</td>
              <td className="path">{d.path}</td>
              <td>
                <span className={`proposal-chip p-${d.status ?? 'open'}`}>{t(`proposal.status.${PROPOSAL_ORDER.includes(d.status ?? 'open') ? (d.status ?? 'open') : 'open'}` as TKey)}</span>
              </td>
              <td style={{ color: 'var(--faint)', whiteSpace: 'nowrap' }}>{d.updated ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Offered while proposals are off; dismissed for good from this browser. */
function ProposalsTip({ t, onActivate }: { t: T; onActivate: () => void }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('mdrules.proposalsTip') === 'hidden'
    } catch {
      return false
    }
  })
  if (hidden) return null
  return (
    <div className="tip">
      <MessageSquareText size={18} />
      <div>
        <strong>{t('dash.tipTitle')}</strong>
        <p>{t('dash.tip')}</p>
      </div>
      <button className="btn primary" onClick={onActivate}>
        {t('dash.tipActivate')}
      </button>
      <button
        className="icon-btn"
        title={t('app.close')}
        onClick={() => {
          setHidden(true)
          try {
            localStorage.setItem('mdrules.proposalsTip', 'hidden')
          } catch {}
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
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

/** One task inside a phase card or the board: status dot, id, title and area. */
function TaskRow({ task, t, onOpen }: { task: DocSummary; t: T; onOpen: (p: string) => void }) {
  return (
    <div
      className="task-row"
      title={task.path}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(task.path)
      }}
    >
      <span className={`task-dot s-${task.status ?? 'pending'}`} title={task.status ? t(`status.${task.status}` as TKey) : ''} />
      {task.id && <span className="task-id">{task.id}</span>}
      <span className="task-title">{task.title}</span>
      {task.tasks.total > 0 && (
        <span className="task-count">
          {task.tasks.done}/{task.tasks.total}
        </span>
      )}
    </div>
  )
}

/** Tasks of the mdrules method by status: what is moving, what is stuck, what is next. */
function TaskBoard({ tasks, t, onOpen }: { tasks: DocSummary[]; t: T; onOpen: (p: string) => void }) {
  const done = tasks.filter((d) => d.status === 'done').length
  return (
    <>
      <h2>
        {t('dash.board')} <span className="h-note">{t('dash.doneCount', { n: done, total: tasks.length })}</span>
      </h2>
      <div className="board">
        {(['in-progress', 'blocked', 'pending'] as const).map((status) => {
          const col = tasks.filter((d) => (d.status ?? 'pending') === status)
          return (
            <div className="board-col" key={status}>
              <div className="board-head">
                <StatusChip status={status} t={t} /> <span className="h-note">{col.length}</span>
              </div>
              {col.map((d) => (
                <div className="board-card" key={d.path}>
                  <TaskRow task={d} t={t} onOpen={onOpen} />
                  {d.area && <span className="task-area">{d.area}</span>}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </>
  )
}

export function Dashboard({ t, tick, onOpen, proposalsActive, onActivateProposals }: { t: T; tick: number; onOpen: (p: string) => void; proposalsActive: boolean; onActivateProposals: () => void }) {
  const [docs, setDocs] = useState<DocSummary[]>([])
  const [sdd, setSdd] = useState<SddSummary>({})
  useEffect(() => {
    api.dashboard().then((d) => {
      setDocs(d.docs)
      setSdd(d.sdd)
    })
  }, [tick])

  const phases = docs.filter((d) => d.type === 'phase').sort((a, b) => (a.phase ?? 999) - (b.phase ?? 999) || a.path.localeCompare(b.path))
  const taskDocs = docs.filter((d) => d.type === 'task').sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? '') || (a.id ?? a.path).localeCompare(b.id ?? b.path))
  const proposals = docs.filter((d) => d.type === 'proposal')
  const others = docs.filter((d) => d.type !== 'phase' && d.type !== 'task' && d.type !== 'proposal')
  const types = [...new Set(others.map((d) => d.type ?? ''))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))

  return (
    <div className="page">
      {!proposalsActive && <ProposalsTip t={t} onActivate={onActivateProposals} />}
      {proposals.length > 0 && <Proposals docs={proposals} t={t} onOpen={onOpen} />}
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
                {taskDocs
                  .filter((d) => d.phase === p.phase)
                  .map((d) => (
                    <TaskRow key={d.path} task={d} t={t} onOpen={onOpen} />
                  ))}
              </div>
            )
          })}
        </div>
      ) : (
        !sdd.openspec && !sdd.speckit && <p style={{ color: 'var(--muted)' }}>{t('dash.noPhases')}</p>
      )}

      {taskDocs.length > 0 && <TaskBoard tasks={taskDocs} t={t} onOpen={onOpen} />}

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
