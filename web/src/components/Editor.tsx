import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { type MutableRefObject, useEffect, useRef } from 'react'
import { api, type FileData, type Lang, type SyncStatus } from '../api'
import { setTheme } from '../editor/livePreview'
import { editorExtensions, externalChange, wrapping } from '../editor/setup'
import type { Theme } from '../editor/widgets'
import type { T } from '../i18n'

interface Props {
  path: string
  /** Language being viewed: the source one or a translation. */
  lang: Lang
  t: T
  /** Changes when font/size/spacing change, so the editor re-measures its lines. */
  layoutKey: string
  wrap: boolean
  theme: Theme
  /** Bumped whenever the server reports a change to this file. */
  externalTick: number
  onLoaded: (file: FileData) => void
  onSaving: (saving: boolean) => void
  onSaved: (status: SyncStatus | null) => void
  /** Undo/redo steps available; reset to zero when the file is closed. */
  onHistory: (h: { undo: number; redo: number }) => void
  /** Filled with the open editor's undo/redo, for buttons outside the editor. */
  commands: MutableRefObject<{ undo: () => void; redo: () => void } | null>
}

export function Editor({ path, lang, t, layoutKey, wrap, theme, externalTick, onLoaded, onSaving, onSaved, onHistory, commands }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const file = useRef<FileData | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<string | null>(null)
  /** Bumped on every local edit, so a reload that raced with typing is discarded. */
  const editSeq = useRef(0)
  /** Contents we wrote ourselves: the watcher echoes them back and they must not reload. */
  const ownWrites = useRef<string[]>([])
  const callbacks = useRef({ onLoaded, onSaving, onSaved, onHistory })
  callbacks.current = { onLoaded, onSaving, onSaved, onHistory }
  const historyKey = useRef('')
  const reportHistory = (state: EditorState | null) => {
    const h = state ? { undo: undoDepth(state), redo: redoDepth(state) } : { undo: 0, redo: 0 }
    const key = `${h.undo}|${h.redo}`
    if (key !== historyKey.current) callbacks.current.onHistory(h)
    historyKey.current = key
  }

  const flush = async () => {
    window.clearTimeout(timer.current)
    const text = pending.current
    const f = file.current
    if (text === null || !f) return
    pending.current = null
    ownWrites.current = [...ownWrites.current.slice(-9), text]
    const res = await api.save(f.path, text, f.target, lang)
    f.content = text
    if (pending.current === null) callbacks.current.onSaving(false)
    callbacks.current.onSaved(res.status)
  }

  useEffect(() => {
    let cancelled = false
    api.file(path, lang).then((data) => {
      if (cancelled || !host.current) return
      file.current = data
      callbacks.current.onLoaded(data)
      view.current = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: data.content,
          extensions: [
            editorExtensions(t, path, wrap, (text) => {
              pending.current = text
              editSeq.current++
              callbacks.current.onSaving(true)
              window.clearTimeout(timer.current)
              timer.current = window.setTimeout(flush, 400)
            }),
            EditorView.updateListener.of((u) => reportHistory(u.state)),
          ],
        }),
      })
      const v = view.current
      commands.current = { undo: () => undo(v), redo: () => redo(v) }
    })
    return () => {
      cancelled = true
      flush()
      view.current?.destroy()
      view.current = null
      commands.current = null
      reportHistory(null)
    }
  }, [path])

  // Reload when the file changes on disk (e.g. the AI edited it), unless we have unsaved edits.
  useEffect(() => {
    if (!externalTick) return
    const seq = editSeq.current
    api.file(path, lang).then((data) => {
      const v = view.current
      if (!v || pending.current !== null || seq !== editSeq.current) return
      const current = v.state.doc.toString()
      // Our own write echoed back: only the sync status may have changed (e.g. after `mdrules sync --mark`).
      if (data.content !== current && ownWrites.current.includes(data.content)) return callbacks.current.onSaved(data.status)
      file.current = data
      callbacks.current.onLoaded(data)
      if (data.content === current) return
      const head = Math.min(v.state.selection.main.head, data.content.length)
      v.dispatch({ changes: { from: 0, to: current.length, insert: data.content }, selection: { anchor: head }, annotations: [externalChange.of(true), Transaction.addToHistory.of(false)] })
    })
  }, [externalTick])

  useEffect(() => {
    view.current?.requestMeasure()
  }, [layoutKey])

  useEffect(() => {
    view.current?.dispatch({ effects: wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }, [wrap])

  useEffect(() => {
    view.current?.dispatch({ effects: setTheme.of(theme) })
  }, [theme])

  return <div className="editor-host" ref={host} />
}
