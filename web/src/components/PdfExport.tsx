import { FileDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Orientation, PaperSize, PdfStyle } from '../editor/pdf'
import type { T } from '../i18n'

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {}
  },
}

/** The toolbar's PDF button: paper size, orientation and style (remembered per browser), then download. */
export function PdfExport({ t, onExport }: { t: T; onExport: (size: PaperSize, orientation: Orientation, style: PdfStyle) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [size, setSize] = useState<PaperSize>(store.get('markode.pdfSize') === 'A3' ? 'A3' : 'A4')
  const [orientation, setOrientation] = useState<Orientation>(store.get('markode.pdfOrientation') === 'landscape' ? 'landscape' : 'portrait')
  const [style, setStyle] = useState<PdfStyle>(store.get('markode.pdfStyle') === 'simple' ? 'simple' : 'markode')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    addEventListener('mousedown', onDown, true)
    addEventListener('keydown', onKey, true)
    return () => {
      removeEventListener('mousedown', onDown, true)
      removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const download = async () => {
    store.set('markode.pdfSize', size)
    store.set('markode.pdfOrientation', orientation)
    store.set('markode.pdfStyle', style)
    setBusy(true)
    try {
      await onExport(size, orientation, style)
      setOpen(false)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pdf-export" ref={box}>
      <button className={`icon-btn${open ? ' active' : ''}`} title={t('pdf.title')} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        <FileDown size={15} />
      </button>
      {open && (
        <div className="pdf-popover">
          <div className="pdf-row">
            <span>{t('pdf.size')}</span>
            <div className="segmented">
              {(['A4', 'A3'] as const).map((s) => (
                <button key={s} className={size === s ? 'active' : ''} onClick={() => setSize(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="pdf-row">
            <span>{t('pdf.orientation')}</span>
            <div className="segmented">
              {(['portrait', 'landscape'] as const).map((o) => (
                <button key={o} className={orientation === o ? 'active' : ''} onClick={() => setOrientation(o)}>
                  {t(`pdf.${o}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="pdf-row">
            <span>{t('pdf.style')}</span>
            <div className="segmented">
              {(['markode', 'simple'] as const).map((s) => (
                <button key={s} className={style === s ? 'active' : ''} title={t(`pdf.${s}Hint`)} onClick={() => setStyle(s)}>
                  {t(`pdf.${s}`)}
                </button>
              ))}
            </div>
          </div>
          <button className="btn primary" disabled={busy} onClick={download}>
            <FileDown size={14} /> {t('pdf.download')}
          </button>
          <p className="pdf-hint">{t('pdf.hint')}</p>
        </div>
      )}
    </div>
  )
}
