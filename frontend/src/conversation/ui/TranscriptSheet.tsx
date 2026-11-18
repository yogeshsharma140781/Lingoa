import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'

export interface TranscriptMessage {
  role: 'ai' | 'you'
  text: string
}

/** The transcript button's sheet: the whole conversation so far. */
export function TranscriptSheet({
  open,
  messages,
  language,
  onClose,
}: {
  open: boolean
  messages: TranscriptMessage[]
  language: string
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true })
  }, [open])
  if (!open) return null
  return (
    <>
      <div className="conv-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="conv-sheet" role="dialog" aria-modal="true" aria-label="Transcript">
        <div className="conv-sheet-head">
          <strong>Transcript</strong>
          <button ref={closeRef} type="button" className="conv-icon-btn" onClick={onClose} aria-label="Close transcript">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="conv-sheet-body">
          {messages.length === 0 && <p className="conv-msg"><small>Nothing yet.</small></p>}
          {messages.map((m, i) => (
            <div className="conv-msg" key={i}>
              <small>{m.role === 'ai' ? 'Partner' : 'You'}</small>
              <p lang={language}>{m.text}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
