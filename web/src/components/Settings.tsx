import { Bot, Check, Copy, EyeOff, Languages, LayoutDashboard, MessageSquare, Radio, RotateCcw, ScrollText, SlidersHorizontal, Sparkles, ToggleRight, Type, X } from 'lucide-react'
import { MarkodeIcon } from './MarkodeIcon'
import { useEffect, useState } from 'react'
import { api, type EditorSettings, type Feature, FEATURES, type Glossary, type Info, type Lang, LANG_NAMES, LANGS, type ProposalLayout, REQUIRES, type TranslationEngine } from '../api'
import { EN_STRINGS, type T, type TKey, UI_LANGS } from '../i18n'
import { browserEngineSupported, resolveEngine, translateUi } from '../translate'

export const FONTS: Record<string, { label: string; stack: string }> = {
  inter: { label: 'Inter', stack: "'Inter', system-ui, sans-serif" },
  plex: { label: 'IBM Plex Sans', stack: "'IBM Plex Sans', system-ui, sans-serif" },
  atkinson: { label: 'Atkinson Hyperlegible', stack: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  serif: { label: 'Source Serif', stack: "'Source Serif 4', Georgia, serif" },
  lora: { label: 'Lora', stack: "'Lora', Georgia, serif" },
  mono: { label: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, monospace" },
  system: { label: 'System', stack: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
}

export const DEFAULT_SETTINGS: EditorSettings = {
  font: 'inter',
  size: 15,
  lineHeight: 1.65,
  padding: 28,
  width: 'full',
  wrap: true,
  uiLang: 'en',
  engine: 'auto',
}

/** Editor settings are applied as CSS variables, so every view picks them up at once. */
export function applySettings(s: EditorSettings) {
  const root = document.documentElement.style
  root.setProperty('--editor-font', (FONTS[s.font] ?? FONTS.inter).stack)
  root.setProperty('--editor-size', `${s.size}px`)
  root.setProperty('--editor-line', String(s.lineHeight))
  root.setProperty('--editor-pad', `${s.padding}px`)
  root.setProperty('--editor-max', s.width === 'readable' ? '820px' : 'none')
  document.documentElement.dataset.wrap = s.wrap ? 'on' : 'off'
}

export type SettingsSection = 'general' | 'features' | 'editor' | 'languages'
/** null follows the system. */
export type Theme = 'light' | 'dark' | null

interface Props {
  t: T
  section: SettingsSection
  theme: Theme
  onTheme: (theme: Theme) => void
  info: Info
  settings: EditorSettings
  onSettings: (s: EditorSettings) => void
  onLanguages: (c: { sourceLang?: Lang; langs?: string[]; langNames?: Record<string, string> }) => void
  /** Translation files behind their source, in every language. */
  pendingTranslations: number
  onProposals: (active: boolean, layout: ProposalLayout) => void
  onFeature: (feature: Feature, on: boolean) => void
  /** Strings of a generated interface language were (re)written. */
  onUiStrings: () => void
  onClose: () => void
}

const SECTIONS: { id: SettingsSection; icon: typeof Type; label: 'settings.general' | 'settings.features' | 'settings.editor' | 'settings.languages' }[] = [
  { id: 'general', icon: SlidersHorizontal, label: 'settings.general' },
  { id: 'features', icon: ToggleRight, label: 'settings.features' },
  { id: 'editor', icon: Type, label: 'settings.editor' },
  { id: 'languages', icon: Languages, label: 'settings.languages' },
]

const FEATURE_ICON: Record<Feature, typeof Type> = {
  agent: Bot,
  rules: ScrollText,
  proposals: MessageSquare,
  live: Radio,
  translations: Languages,
  dashboard: LayoutDashboard,
  skills: Sparkles,
  vscode: EyeOff,
}

/** What turning a module on or off writes in the project; nothing for the ones that only change this interface. */
function featureFiles(f: Feature, mainDoc: string): string[] {
  const doc = mainDoc
  switch (f) {
    case 'agent':
      return [`${doc} (Working rules)`, '.claude/skills/markode', '.agents/skills/markode']
    case 'rules':
      return [`${doc} (Working rules)`]
    case 'proposals':
      return [`${doc} (Proposals)`, '.claude/skills/markode-proposals']
    case 'live':
      return ['.claude/settings.local.json']
    case 'dashboard':
      return [`${doc} (Workflow)`, 'docs/', '.claude/skills/markode-*']
    case 'vscode':
      return ['.vscode/settings.json']
    default:
      return []
  }
}

/** A module: what it does, what it writes, and its switch. */
function FeatureRow({ t, feature, info, onFeature, children }: { t: T; feature: Feature; info: Info; onFeature: (f: Feature, on: boolean) => void; children?: React.ReactNode }) {
  const on = info.features[feature]
  const Icon = FEATURE_ICON[feature]
  const need = REQUIRES[feature]
  const doc = info.mainDoc ?? 'CLAUDE.md'
  const files = featureFiles(feature, doc)
  const name = (f: Feature) => t(`feature.${f}` as TKey)
  const toggle = () => {
    const turnOff = on ? FEATURES.filter((f) => REQUIRES[f] === feature && info.features[f]) : []
    const turnOn = !on && need && !info.features[need] ? [need] : []
    const lines = [
      on ? t('feature.confirmOff', { name: name(feature) }) : t('feature.confirmOn', { name: name(feature) }),
      ...(files.length ? ['', t('feature.files'), ...files.map((f) => `• ${f}`)] : []),
      ...(turnOff.length ? ['', t('feature.alsoOff', { list: turnOff.map(name).join(', ') })] : []),
      ...(turnOn.length ? ['', t('feature.alsoOn', { list: turnOn.map(name).join(', ') })] : []),
    ]
    // Modules that only change this interface switch at once; the rest say what they will write first.
    if ((files.length || turnOff.length || turnOn.length) && !confirm(lines.join('\n'))) return
    onFeature(feature, !on)
  }
  return (
    <div className={`feature${on ? ' on' : ''}`}>
      <Icon size={16} className="feature-icon" />
      <div className="feature-body">
        <div className="feature-name">
          {name(feature)}
          {need && !info.features[need] && <span className="feature-need">{t('feature.needs', { name: name(need) })}</span>}
        </div>
        <p className="set-hint">{t(`feature.${feature}.hint` as TKey)}</p>
        {files.length > 0 && <p className="feature-files">{files.join(' · ')}</p>}
        {on && children}
      </div>
      <button className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={name(feature)} onClick={toggle}>
        <span />
      </button>
    </div>
  )
}

/** A command for the agent with a button that copies it, e.g. `/markode translate`. */
export function CopyCommand({ command, t }: { command: string; t: T }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="copy-command">
      <code>{command}</code>
      <button
        className="btn small"
        onClick={() =>
          navigator.clipboard?.writeText(command).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }
      >
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? t('app.copied') : t('app.copy')}
      </button>
    </span>
  )
}

const OTHER = '__other__'

/** Add a translation language: a built-in one, or any other by name and code (the AI translates into it). */
function AddLanguage({ t, info, onAdd }: { t: T; info: Info; onAdd: (code: string, name?: string) => void }) {
  const [other, setOther] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const taken = (c: string) => c === info.sourceLang || info.langs.includes(c)
  const validCode = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(code) && !taken(code.toLowerCase())
  if (other)
    return (
      <div className="add-lang">
        <input className="control" placeholder={t('settings.langName')} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        <input className="control code" placeholder={t('settings.langCode')} value={code} maxLength={11} onChange={(e) => setCode(e.target.value)} />
        <button className="btn small" disabled={!name.trim() || !validCode} onClick={() => (onAdd(code.toLowerCase(), name.trim()), setOther(false), setName(''), setCode(''))}>
          {t('settings.add')}
        </button>
        <button className="icon-btn" title={t('app.close')} onClick={() => setOther(false)}>
          <X size={14} />
        </button>
      </div>
    )
  return (
    <select
      className="control add-lang-select"
      value=""
      onChange={(e) => (e.target.value === OTHER ? setOther(true) : e.target.value && onAdd(e.target.value))}
    >
      <option value="">+ {t('settings.addLang')}</option>
      {LANGS.filter((l) => !taken(l)).map((l) => (
        <option key={l} value={l}>
          {LANG_NAMES[l]}
        </option>
      ))}
      <option value={OTHER}>{t('settings.otherLang')}</option>
    </select>
  )
}

const ENGINE_LABEL: Record<TranslationEngine, TKey> = { auto: 'settings.engineAuto', browser: 'settings.engineBrowser', agent: 'settings.engineAgent' }

/** Which engine translates the docs: the browser's built-in translator, or the agent. */
function EngineSettings({ t, settings, set }: { t: T; settings: EditorSettings; set: (patch: Partial<EditorSettings>) => void }) {
  const hint: Record<TranslationEngine, string> = {
    auto: t('settings.engineHintAuto', { engine: t(ENGINE_LABEL[resolveEngine('auto')]) }),
    browser: browserEngineSupported() ? t('settings.engineHintBrowser') : t('settings.engineHintBrowserOff'),
    agent: t('settings.engineHintAgent'),
  }
  return (
    <>
      <div className="set-row">
        <span className="set-label">{t('settings.engine')}</span>
        <div className="segmented">
          {(['auto', 'browser', 'agent'] as const).map((e) => (
            <button key={e} className={settings.engine === e ? 'active' : ''} disabled={e === 'browser' && !browserEngineSupported()} onClick={() => set({ engine: e })}>
              {t(ENGINE_LABEL[e])}
            </button>
          ))}
        </div>
      </div>
      <p className="set-hint">{hint[settings.engine]}</p>
    </>
  )
}

/** Terms no engine translates, and fixed translations per language (for the agent). */
function GlossaryEditor({ t, info }: { t: T; info: Info }) {
  const [glossary, setGlossary] = useState<Glossary | null>(null)
  const [keep, setKeep] = useState('')
  const [terms, setTerms] = useState<Record<string, string>>({})
  useEffect(() => {
    api.glossary().then((g) => {
      setGlossary(g)
      setKeep(g.keep.join(', '))
      setTerms(Object.fromEntries(Object.entries(g.terms).map(([l, m]) => [l, Object.entries(m).map(([a, b]) => `${a} = ${b}`).join('\n')])))
    })
  }, [])
  if (!glossary) return null
  const save = (nextKeep = keep, nextTerms = terms) => {
    const parsed = Object.fromEntries(
      Object.entries(nextTerms).map(([l, text]) => [
        l,
        Object.fromEntries(
          text
            .split('\n')
            .map((line) => line.split('='))
            .filter((p) => p.length === 2 && p[0].trim() && p[1].trim())
            .map(([a, b]) => [a.trim(), b.trim()]),
        ),
      ]),
    )
    api.saveGlossary({ keep: nextKeep.split(',').map((x) => x.trim()).filter(Boolean), terms: parsed }).then(setGlossary)
  }
  return (
    <>
      <div className="set-title">{t('settings.glossary')}</div>
      <label className="set-row top">
        <span className="set-label">{t('settings.glossaryKeep')}</span>
        <textarea className="glossary-input" value={keep} placeholder="markode, skill, frontmatter" onChange={(e) => setKeep(e.target.value)} onBlur={() => save()} />
      </label>
      <p className="set-hint">{t('settings.glossaryKeepHint')}</p>
      {info.langs.map((l) => (
        <label key={l} className="set-row top">
          <span className="set-label">{t('settings.glossaryTerms', { lang: info.langNames[l] ?? l })}</span>
          <textarea className="glossary-input" value={terms[l] ?? ''} placeholder="proposal = …" onChange={(e) => setTerms({ ...terms, [l]: e.target.value })} onBlur={() => save()} />
        </label>
      ))}
      {info.langs.length > 0 && <p className="set-hint">{t('settings.glossaryTermsHint')}</p>}
    </>
  )
}

/**
 * The interface language: a built-in one, one the user's engine already translated, or a new one,
 * translated now from English and kept in ~/.markode/.
 */
function UiLanguage({ t, settings, set, onUiStrings }: { t: T; settings: EditorSettings; set: (patch: Partial<EditorSettings>) => void; onUiStrings: () => void }) {
  const [generated, setGenerated] = useState<Record<string, string>>({})
  const [other, setOther] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [progress, setProgress] = useState<string | null>(null)
  const engine = resolveEngine(settings.engine)
  useEffect(() => {
    api.uiLangs().then(setGenerated, () => {})
  }, [])
  const generate = async (lang: string, langName: string) => {
    try {
      setProgress(t('settings.uiLangGenerating', { done: 0, total: Object.keys(EN_STRINGS).length }))
      const strings = await translateUi(engine, EN_STRINGS, lang, (done, total) => setProgress(t('settings.uiLangGenerating', { done, total })))
      await api.saveUiStrings(lang, langName, strings)
      setGenerated((g) => ({ ...g, [lang]: langName }))
      setProgress(null)
      setOther(false)
      onUiStrings()
      set({ uiLang: lang })
    } catch (e) {
      setProgress((e as Error).message)
    }
  }
  const builtIn = (UI_LANGS as string[]).includes(settings.uiLang)
  const validCode = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(code) && !(UI_LANGS as string[]).includes(code.toLowerCase())
  return (
    <>
      <label className="set-row">
        <span className="set-label">{t('settings.uiLang')}</span>
        <select className="control" value={other ? OTHER : settings.uiLang} onChange={(e) => (e.target.value === OTHER ? setOther(true) : (setOther(false), set({ uiLang: e.target.value })))}>
          {UI_LANGS.map((l) => (
            <option key={l} value={l}>
              {LANG_NAMES[l]}
            </option>
          ))}
          {Object.entries(generated).map(([l, n]) => (
            <option key={l} value={l}>
              {n}
            </option>
          ))}
          <option value={OTHER}>{t('settings.uiLangOther')}</option>
        </select>
        {!builtIn && !other && engine !== 'agent' && (
          <button className="btn small" disabled={!!progress} onClick={() => generate(settings.uiLang, generated[settings.uiLang] ?? settings.uiLang)}>
            {t('settings.uiLangRegenerate')}
          </button>
        )}
      </label>
      {other && engine === 'agent' && <p className="set-hint">{t('settings.uiLangNeedsEngine')}</p>}
      {other && engine !== 'agent' && (
        <div className="add-lang">
          <input className="control" placeholder={t('settings.langName')} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          <input className="control code" placeholder={t('settings.langCode')} value={code} maxLength={11} onChange={(e) => setCode(e.target.value)} />
          <button className="btn small" disabled={!name.trim() || !validCode || !!progress} onClick={() => generate(code.toLowerCase(), name.trim())}>
            {t('settings.uiLangGenerate')}
          </button>
        </div>
      )}
      {progress && <p className="set-hint">{progress}</p>}
      <p className="set-hint">{t('settings.uiLangHint')}</p>
    </>
  )
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="set-row">
      <span className="set-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="set-value">
        {Number.isInteger(step) ? value : value.toFixed(2)}
        {unit}
      </span>
    </label>
  )
}

export function Settings({ t, section: initialSection, theme, onTheme, info, settings, onSettings, onLanguages, pendingTranslations, onProposals, onFeature, onUiStrings, onClose }: Props) {
  const [section, setSection] = useState(initialSection)
  const set = (patch: Partial<EditorSettings>) => onSettings({ ...settings, ...patch })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={t('app.settings')}>
        <div className="modal-head">
          <strong>{t('app.settings')}</strong>
          <button className="icon-btn" title={t('app.close')} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <nav className="set-nav">
            {SECTIONS.map((s) => (
              <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => setSection(s.id)}>
                <s.icon size={15} /> {t(s.label)}
              </button>
            ))}
          </nav>

          {section === 'general' && (
            <section>
              <div className="set-title">{t('settings.general')}</div>
              <UiLanguage t={t} settings={settings} set={set} onUiStrings={onUiStrings} />
              <div className="set-row">
                <span className="set-label">{t('app.theme')}</span>
                <div className="segmented">
                  {([null, 'light', 'dark'] as const).map((th) => (
                    <button key={String(th)} className={theme === th ? 'active' : ''} onClick={() => onTheme(th)}>
                      {th === null ? t('settings.themeSystem') : th === 'light' ? t('settings.themeLight') : t('settings.themeDark')}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {section === 'editor' && (
            <section>
              <div className="set-title">
                {t('settings.editor')}
                <button className="btn small" onClick={() => onSettings({ ...DEFAULT_SETTINGS, uiLang: settings.uiLang, engine: settings.engine })}>
                  <RotateCcw size={12} /> {t('settings.reset')}
                </button>
              </div>
              <label className="set-row">
                <span className="set-label">{t('settings.font')}</span>
                <select className="control" value={settings.font} onChange={(e) => set({ font: e.target.value })}>
                  {Object.entries(FONTS).map(([id, f]) => (
                    <option key={id} value={id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <Slider label={t('settings.size')} value={settings.size} min={12} max={22} step={1} unit="px" onChange={(size) => set({ size })} />
              <Slider label={t('settings.lineHeight')} value={settings.lineHeight} min={1.2} max={2.2} step={0.05} unit="" onChange={(lineHeight) => set({ lineHeight })} />
              <Slider label={t('settings.padding')} value={settings.padding} min={0} max={200} step={4} unit="px" onChange={(padding) => set({ padding })} />
              <div className="set-row">
                <span className="set-label">{t('settings.width')}</span>
                <div className="segmented">
                  {(['full', 'readable'] as const).map((w) => (
                    <button key={w} className={settings.width === w ? 'active' : ''} onClick={() => set({ width: w })}>
                      {w === 'full' ? t('settings.widthFull') : t('settings.widthReadable')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="set-row">
                <span className="set-label">{t('settings.wrap')}</span>
                <div className="segmented">
                  {[true, false].map((w) => (
                    <button key={String(w)} className={settings.wrap === w ? 'active' : ''} onClick={() => set({ wrap: w })}>
                      {w ? t('settings.wrapOn') : t('settings.wrapOff')}
                    </button>
                  ))}
                </div>
              </div>
              <p className="set-hint">{t('settings.wrapHint')}</p>
              <div className="set-preview">
                <div className="set-preview-h">markode</div>
                <p>{t('settings.preview')}</p>
              </div>
            </section>
          )}

          {section === 'languages' && !info.features.agent && (
            <section>
              <div className="set-title">{t('settings.languages')}</div>
              <p className="set-hint">{t('settings.languagesOff')}</p>
            </section>
          )}

          {section === 'languages' && info.features.agent && (
            <section>
              <div className="set-title">{t('settings.languages')}</div>
              <label className="set-row">
                <span className="set-label">{t('settings.source')}</span>
                <select className="control" value={info.sourceLang} disabled={!info.mainDoc} onChange={(e) => onLanguages({ sourceLang: e.target.value as Lang })}>
                  {LANGS.map((l) => (
                    <option key={l} value={l}>
                      {LANG_NAMES[l]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="set-hint">{info.mainDoc ? t('settings.sourceHint', { doc: info.mainDoc }) : t('rules.noMain')}</p>
              {!info.features.translations && <p className="set-hint">{t('settings.translationsOff')}</p>}
              {info.features.translations && (
              <>
              <div className="set-row top">
                <span className="set-label">{t('settings.translations')}</span>
                <div className="chips">
                  {info.langs.map((l) => (
                    <button key={l} className="chip on" title={t('settings.removeLang')} onClick={() => onLanguages({ langs: info.langs.filter((x) => x !== l) })}>
                      {info.langNames[l] ?? l} ×
                    </button>
                  ))}
                  <AddLanguage t={t} info={info} onAdd={(code, name) => onLanguages({ langs: [...info.langs, code], ...(name ? { langNames: { [code]: name } } : {}) })} />
                </div>
              </div>
              <p className="set-hint">{t('settings.translationsHint')}</p>
              <EngineSettings t={t} settings={settings} set={set} />
              {resolveEngine(settings.engine) === 'agent' && info.langs.length > 0 && pendingTranslations > 0 && (
                <div className="set-callout">
                  {t('settings.toTranslate', { n: pendingTranslations })} <CopyCommand command="/markode translate" t={t} />
                </div>
              )}
              <GlossaryEditor t={t} info={info} />
              </>
              )}
            </section>
          )}

          {section === 'features' && (
            <section>
              <div className="set-title">{t('settings.features')}</div>
              <p className="set-hint">{t('settings.featuresHint')}</p>
              <div className="feature on fixed">
                <MarkodeIcon size={16} className="feature-icon" />
                <div className="feature-body">
                  <div className="feature-name">{t('feature.viewer')}</div>
                  <p className="set-hint">{t('feature.viewer.hint')}</p>
                </div>
                <span className="feature-always">{t('feature.always')}</span>
              </div>
              {FEATURES.map((f) => (
                <FeatureRow key={f} t={t} feature={f} info={info} onFeature={onFeature}>
                  {f === 'proposals' && (
                    <div className="set-row">
                      <span className="set-label">{t('settings.layout')}</span>
                      <div className="segmented">
                        {(['general', 'structured'] as const).map((l) => (
                          <button key={l} className={info.proposals.layout === l ? 'active' : ''} onClick={() => onProposals(true, l)}>
                            {l === 'general' ? t('settings.layoutGeneral') : t('settings.layoutStructured')}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {f === 'live' && <p className="set-hint">{t('feature.live.note')}</p>}
                </FeatureRow>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
