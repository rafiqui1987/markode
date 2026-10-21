import { RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type EditorSettings, type Info, type Lang, LANG_NAMES, LANGS, type ProposalLayout } from '../api'
import type { T } from '../i18n'

export const FONTS: Record<string, { label: string; stack: string }> = {
  inter: { label: 'Inter', stack: "'Inter', system-ui, sans-serif" },
  plex: { label: 'IBM Plex Sans', stack: "'IBM Plex Sans', system-ui, sans-serif" },
  atkinson: { label: 'Atkinson Hyperlegible', stack: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  serif: { label: 'Source Serif', stack: "'Source Serif 4', Georgia, serif" },
  lora: { label: 'Lora', stack: "'Lora', Georgia, serif" },
  mono: { label: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, monospace" },
  system: { label: 'System', stack: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
}

export const DEFAULT_SETTINGS: EditorSettings = { font: 'inter', size: 15, lineHeight: 1.65, padding: 28, width: 'full', wrap: true }

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

interface Props {
  t: T
  info: Info
  settings: EditorSettings
  onSettings: (s: EditorSettings) => void
  onLanguages: (c: { sourceLang?: Lang; langs?: string[] }) => void
  onProposals: (active: boolean, layout: ProposalLayout) => void
  onClose: () => void
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

export function Settings({ t, info, settings, onSettings, onLanguages, onProposals, onClose }: Props) {
  const set = (patch: Partial<EditorSettings>) => onSettings({ ...settings, ...patch })
  // Chosen before activating; once active, every change is saved right away.
  const [layout, setLayout] = useState<ProposalLayout>(info.proposals.layout)

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

        <section>
          <div className="set-title">
            {t('settings.editor')}
            <button className="btn small" onClick={() => onSettings({ ...DEFAULT_SETTINGS })}>
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
            <div className="set-preview-h">mdrules</div>
            <p>{t('settings.preview')}</p>
          </div>
        </section>

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
          <div className="set-row top">
            <span className="set-label">{t('settings.translations')}</span>
            {info.langs.length ? (
              <div className="chips">
                {info.langs.map((l) => (
                  <button key={l} className="chip on" title={t('settings.removeLang')} onClick={() => onLanguages({ langs: info.langs.filter((x) => x !== l) })}>
                    {info.langNames[l] ?? l} ×
                  </button>
                ))}
              </div>
            ) : (
              <span className="set-value">{t('settings.noTranslations')}</span>
            )}
          </div>
          <p className="set-hint">
            {t('settings.translationsHint')} {t('settings.addLangHint')} <code>mdrules translate</code>
          </p>
        </section>

        <section id="settings-proposals">
          <div className="set-title">{t('settings.proposals')}</div>
          <p className="set-hint">{t('settings.proposalsHint')}</p>
          <div className="set-row">
            <span className="set-label">{t('settings.layout')}</span>
            <div className="segmented">
              {(['general', 'structured'] as const).map((l) => (
                <button
                  key={l}
                  className={layout === l ? 'active' : ''}
                  onClick={() => {
                    setLayout(l)
                    if (info.proposals.active) onProposals(true, l)
                  }}
                >
                  {l === 'general' ? t('settings.layoutGeneral') : t('settings.layoutStructured')}
                </button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <span className="set-label">{info.proposals.active ? t('settings.proposalsOn') : t('settings.proposalsOff')}</span>
            <button className={`btn${info.proposals.active ? '' : ' primary'}`} onClick={() => onProposals(!info.proposals.active, layout)}>
              {info.proposals.active ? t('settings.deactivate') : t('settings.activate')}
            </button>
          </div>
          <p className="set-hint">{t('settings.proposalsFiles')}</p>
        </section>
      </div>
    </div>
  )
}
