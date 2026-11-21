import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'

/** The three-dots button's sheet: the settings that belong to the conversation screen. */
export function SettingsSheet({
  open,
  soundOn,
  onToggleSound,
  onClose,
}: {
  open: boolean
  soundOn: boolean
  onToggleSound: () => void
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true })
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="conv-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="conv-sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="conv-sheet-head">
          <strong>Settings</strong>
          <button ref={closeRef} type="button" className="conv-icon-btn" onClick={onClose} aria-label="Close settings">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="conv-sheet-body">
          <div className="conv-setting">
            <div>
              <div className="conv-setting-label" id="conv-sounds-label">Turn-taking sounds</div>
              <div className="conv-setting-hint">A short chime when it's your turn to speak and when your turn ends.</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              aria-labelledby="conv-sounds-label"
              className="conv-switch"
              data-on={soundOn ? 'true' : 'false'}
              onClick={onToggleSound}
            >
              <i />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
