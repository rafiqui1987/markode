import { AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FolderDown, Lock, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type ProjectTarget, type Skill, type SkillSource, type SkillsData } from '../api'
import type { Theme } from '../editor/widgets'
import type { T, TKey } from '../i18n'
import { Editor, type EditorCommands } from './Editor'

type GroupBy = 'tag' | 'source'

const SOURCES: SkillSource[] = ['claude', 'agents', 'codex', 'gemini', 'copilot', 'cursor']
const TARGETS: ProjectTarget[] = ['claude', 'agents']
const GROUP_KEY = 'markode.skillsGroupBy'

const sourceLabel = (s: SkillSource, t: T) => (s === 'agents' ? t('skills.shared') : { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', copilot: 'Copilot', cursor: 'Cursor' }[s])

interface EditorLook {
  layoutKey: string
  wrap: boolean
  theme: Theme
}

/** Global skills of every agent, grouped by tag or location, editable in place and copyable into the project. */
export function Skills({ t, tick, look }: { t: T; tick: number; look: EditorLook }) {
  const [data, setData] = useState<SkillsData | null>(null)
  const [query, setQuery] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>(() => {
    try {
      return localStorage.getItem(GROUP_KEY) === 'source' ? 'source' : 'tag'
    } catch {
      return 'tag'
    }
  })
  /** Open cards, as `group|key`: a skill listed under two tags opens in each separately. */
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [folded, setFolded] = useState<Set<string>>(new Set())

  const reload = () => api.skills().then(setData)
  useEffect(() => {
    reload()
  }, [tick])
  useEffect(() => {
    try {
      localStorage.setItem(GROUP_KEY, groupBy)
    } catch {}
  }, [groupBy])

  const q = query.trim().toLowerCase()
  const skills = useMemo(
    () => (data?.skills ?? []).filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.tags.some((tag) => tag.includes(q))),
    [data, q],
  )
  const allTags = useMemo(() => [...new Set((data?.skills ?? []).flatMap((s) => s.tags))].sort(), [data])

  const groups = useMemo(() => {
    if (groupBy === 'source') {
      return SOURCES.map((src) => ({ id: src, label: sourceLabel(src, t), skills: skills.filter((s) => s.locations.some((l) => l.source === src)) })).filter((g) => g.skills.length)
    }
    const tagged = allTags.map((tag) => ({ id: tag, label: tag, skills: skills.filter((s) => s.tags.includes(tag)) })).filter((g) => g.skills.length)
    const untagged = skills.filter((s) => !s.tags.length)
    return untagged.length ? [...tagged, { id: '', label: t('skills.untagged'), skills: untagged }] : tagged
  }, [skills, groupBy, allTags, t])

  const cardIds = groups.flatMap((g) => g.skills.map((s) => `${g.id}|${s.key}`))
  const anyOpen = cardIds.some((id) => open.has(id))
  const toggleIn = (set: Set<string>, id: string) => {
    const n = new Set(set)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  }

  const setTags = async (skill: Skill, tags: string[]) => {
    await api.setSkillTags(skill.name, tags)
    reload()
  }

  if (!data) return <div className="page" />

  return (
    <div className="page">
      <div className="skills">
        <div className="row">
          <h2 style={{ margin: 0, flex: 1 }}>{t('skills.title')}</h2>
          <div className="skills-search">
            <Search size={13} />
            <input value={query} placeholder={t('skills.search')} onChange={(e) => setQuery(e.target.value)} />
            {query && (
              <button className="icon-btn" title={t('app.clear')} onClick={() => setQuery('')}>
                <X size={13} />
              </button>
            )}
          </div>
          <div className="segmented" title={t('skills.groupBy')}>
            <button className={groupBy === 'tag' ? 'active' : ''} onClick={() => setGroupBy('tag')}>
              {t('skills.byTag')}
            </button>
            <button className={groupBy === 'source' ? 'active' : ''} onClick={() => setGroupBy('source')}>
              {t('skills.bySource')}
            </button>
          </div>
          <button className="icon-btn" title={anyOpen ? t('app.collapseAll') : t('app.expandAll')} onClick={() => setOpen(new Set(anyOpen ? [] : cardIds))}>
            {anyOpen ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
          </button>
        </div>
        <p className="sub">
          {t('skills.subtitle')}{' '}
          {data.sources
            .filter((s) => s.exists)
            .map((s) => s.path)
            .join(' · ')}
        </p>

        {!data.skills.length && <p className="sub">{t('skills.none')}</p>}
        {!!data.skills.length && !skills.length && <p className="sub">{t('app.noResults')}</p>}

        {groups.map((g) => (
          <section key={g.id || '-'}>
            <h3 className="skills-group" onClick={() => setFolded((f) => toggleIn(f, g.id))}>
              {folded.has(g.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span>{g.label}</span>
              <span className="count">{g.skills.length}</span>
            </h3>
            {!folded.has(g.id) &&
              g.skills.map((s) => {
                const id = `${g.id}|${s.key}`
                return (
                  <SkillCard
                    key={id}
                    skill={s}
                    t={t}
                    look={look}
                    open={open.has(id)}
                    onToggle={() => setOpen((o) => toggleIn(o, id))}
                    allTags={allTags}
                    onTags={(tags) => setTags(s, tags)}
                    defaultTargets={data.targets}
                    onInstalled={reload}
                  />
                )
              })}
          </section>
        ))}
      </div>
    </div>
  )
}

interface CardProps {
  skill: Skill
  t: T
  look: EditorLook
  open: boolean
  onToggle: () => void
  allTags: string[]
  onTags: (tags: string[]) => void
  defaultTargets: ProjectTarget[]
  onInstalled: () => void
}

function SkillCard({ skill, t, look, open, onToggle, allTags, onTags, defaultTargets, onInstalled }: CardProps) {
  const [adding, setAdding] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [targets, setTargets] = useState<ProjectTarget[]>(skill.installed.length ? skill.installed : defaultTargets)

  const install = async () => {
    const replacing = targets.filter((x) => skill.installed.includes(x))
    if (replacing.length && !confirm(t('skills.overwrite', { name: skill.folder, dirs: replacing.map((x) => t(`skills.target.${x}` as TKey)).join(', ') }))) return
    const ok = await api.installSkill(skill.key, targets, replacing.length > 0).then(
      () => true,
      (e) => (alert(e.message), false),
    )
    if (!ok) return
    setInstalling(false)
    onInstalled()
  }

  return (
    <div className={`skill-card${open ? ' open' : ''}`}>
      <div className="skill-head" onClick={onToggle}>
        <span className="chev">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <span className="skill-name">{skill.name}</span>
        {skill.locations.map((l) => (
          <span key={l.path} className={`src-chip src-${l.source}`} title={l.path}>
            {sourceLabel(l.source, t)}
          </span>
        ))}
        {skill.managed && (
          <span className="skill-flag" title={t('skills.managed')}>
            <Lock size={12} />
          </span>
        )}
        {!!skill.issues.length && (
          <span className="skill-flag warn" title={skill.issues.map((i) => t(`skills.issue.${i}` as TKey, { dir: skill.folder })).join('\n')}>
            <AlertTriangle size={13} />
          </span>
        )}
        <span className="spacer" />
        {!!skill.installed.length && (
          <span className="pill" title={skill.installed.map((x) => t(`skills.target.${x}` as TKey)).join('\n')}>
            {t('skills.inProject')}
          </span>
        )}
        <button
          className="btn small"
          onClick={(e) => {
            e.stopPropagation()
            setInstalling((v) => !v)
          }}
        >
          <FolderDown size={13} /> {t('skills.install')}
        </button>
      </div>

      {installing && (
        <div className="skill-install">
          <span>{t('skills.installTo')}</span>
          {TARGETS.map((x) => (
            <label key={x}>
              <input type="checkbox" checked={targets.includes(x)} onChange={(e) => setTargets((ts) => (e.target.checked ? [...ts, x] : ts.filter((y) => y !== x)))} />
              {t(`skills.target.${x}` as TKey)}
            </label>
          ))}
          <span className="spacer" />
          <button className="btn small primary" disabled={!targets.length} onClick={install}>
            {t('skills.copy')}
          </button>
          <button className="btn small" onClick={() => setInstalling(false)}>
            {t('skills.cancel')}
          </button>
        </div>
      )}

      {skill.description && <p className={`skill-desc${open ? '' : ' clamp'}`}>{skill.description}</p>}

      <div className="skill-tags">
        {skill.tags.map((tag) => (
          <span key={tag} className="tag">
            {tag}
            <button title={t('skills.removeTag', { tag })} onClick={() => onTags(skill.tags.filter((x) => x !== tag))}>
              <X size={11} />
            </button>
          </span>
        ))}
        {adding ? (
          <TagInput
            options={allTags.filter((x) => !skill.tags.includes(x))}
            onDone={(tag) => {
              setAdding(false)
              if (tag) onTags([...skill.tags, tag])
            }}
          />
        ) : (
          <button className="tag add" onClick={() => setAdding(true)}>
            <Plus size={11} /> {t('skills.addTag')}
          </button>
        )}
      </div>

      {open && (
        <>
          {!!skill.files.length && (
            <div className="skill-files">
              <span>{t('skills.files')}</span>
              {skill.files.map((f) => (
                <code key={f}>{f}</code>
              ))}
            </div>
          )}
          <SkillEditor skill={skill} t={t} look={look} />
        </>
      )}
    </div>
  )
}

function TagInput({ options, onDone }: { options: string[]; onDone: (tag: string | null) => void }) {
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v?.trim().toLowerCase() || null)
  }
  const listId = useMemo(() => `tags-${Math.random().toString(36).slice(2)}`, [])
  return (
    <>
      <input
        className="tag-input"
        autoFocus
        list={listId}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(e.currentTarget.value)
          if (e.key === 'Escape') finish(null)
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  )
}

function SkillEditor({ skill, t, look }: { skill: Skill; t: T; look: EditorLook }) {
  const commands = useRef<EditorCommands | null>(null)
  const [saving, setSaving] = useState(false)
  return (
    <div className="skill-editor">
      <div className="skill-editor-bar">
        <code title={skill.locations.map((l) => l.path).join('\n')}>{skill.locations[0].path}/SKILL.md</code>
        <span className="spacer" />
        <span>{skill.managed ? t('skills.readOnly') : saving ? t('app.saving') : t('app.saved')}</span>
      </div>
      <Editor
        path={`${skill.key}/SKILL.md`}
        lang="en"
        t={t}
        layoutKey={look.layoutKey}
        wrap={look.wrap}
        theme={look.theme}
        externalTick={0}
        onLoaded={() => {}}
        onSaving={setSaving}
        onSaved={() => {}}
        onHistory={() => {}}
        commands={commands}
        io={{ load: () => api.skillFile(skill.key), save: (text) => api.saveSkillFile(skill.key, text) }}
        readOnly={skill.managed}
      />
    </div>
  )
}
