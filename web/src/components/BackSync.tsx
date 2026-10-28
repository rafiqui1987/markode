import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { T } from '../i18n'
import { type BackResult, type Engine, translateBack } from '../translate'

interface Props {
  t: T
  path: string
  lang: string
  engine: Engine
  onClose: () => void
  /** The original was written. */
  onApplied: () => void
}

/** An edited translation's changes, translated back into the source language, to approve or not. */
export function BackSync({ t, path, lang, engine, onClose, onApplied }: Props) {
  const [result, setResult] = useState<BackResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    translateBack(engine, path, lang).then(setResult, (e) => setError(e.message))
  }, [engine, path, lang])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const apply = async () => {
    if (!result || result.structural) return
    setBusy(true)
    try {
      await api.backAccept(path, lang, result.results)
      onApplied()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={t('back.title')}>
        <div className="modal-head">
          <strong>{t('back.title')}</strong>
          <button className="icon-btn" title={t('app.close')} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <section className="back-sync">
          <code className="back-path">{path}</code>
          {error && <p className="set-callout">{error}</p>}
          {!error && !result && <p className="set-hint">{t('back.loading')}</p>}
          {result?.structural && <p className="set-callout">{t('back.structural')}</p>}
          {result && !result.structural && (
            <>
              {result.changes.length === 0 && <p className="set-hint">{t('back.none')}</p>}
              {result.changes.map((c, i) => (
                <div key={i} className="back-change">
                  <del>{c.before}</del>
                  <ins>{c.after}</ins>
                </div>
              ))}
              {result.rejected > 0 && <p className="set-hint">{t('back.rejected', { n: result.rejected })}</p>}
            </>
          )}
          <div className="back-actions">
            <button className="btn" onClick={onClose}>
              {t('back.cancel')}
            </button>
            <button className="btn primary" disabled={busy || !result || result.structural || !result.changes.length} onClick={apply}>
              {t('back.apply')}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
