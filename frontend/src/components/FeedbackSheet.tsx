import { useState } from 'react'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
import { useStore } from '../store'
import { useApi } from '../hooks/useApi'
import { markFeedbackAsked, sendFeedback } from '../feedback'


// Spoken to screen readers only; sighted users just see the stars fill.
const STAR_NAMES = ['awful', 'bad', 'okay', 'good', 'great']

// Asked once, right after the first real conversation. Sent to the developer's inbox.
export function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const { userId, targetLanguage } = useStore()
  const { logEvent } = useApi()
  const [rating, setRating] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [thanks, setThanks] = useState(false)

  const canSend = (rating !== null || message.trim().length > 0) && !sending

  const notNow = () => {
    markFeedbackAsked()
    logEvent('feedback_dismissed')
    onClose()
  }

  const send = async () => {
    if (!canSend) return
    setSending(true)
    setFailed(false)
    const ok = await sendFeedback({ userId, targetLanguage, rating, message, email })
    setSending(false)
    if (!ok) {
      setFailed(true) // keep what they typed; they can try again or tap "Not now"
      return
    }
    markFeedbackAsked()
    setThanks(true)
    window.setTimeout(onClose, 1600)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex items-end justify-center p-4 bg-black/30"
      onClick={thanks ? undefined : notNow}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ duration: 0.2 }}
        role="dialog"
        aria-modal="true"
        aria-label="Send feedback"
        className="w-full max-w-md max-h-full overflow-y-auto lt-card p-6 shadow-[0_8px_30px_rgba(0,0,0,0.15)]"
        onClick={(e) => e.stopPropagation()}
      >
        {thanks ? (
          <div className="text-center py-8">
            <h3 className="font-display text-xl font-semibold mb-2">Thank you!</h3>
            <p className="lt-muted text-sm">I read every message.</p>
          </div>
        ) : (
          <>
            <h3 className="font-display text-xl font-semibold mb-2">Hi, I'm Yogesh, the one person behind Lingoa.</h3>
            <p className="lt-muted text-sm mb-5 leading-relaxed">
              Your first session helps me more than anything else. What would make this better for you?
            </p>

            <div className="mb-4 flex justify-center gap-1" role="radiogroup" aria-label="Your rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} star${n === 1 ? '' : 's'}: ${STAR_NAMES[n - 1]}`}
                  onClick={() => setRating(n)}
                  className="w-12 h-12 flex items-center justify-center"
                >
                  <Star
                    className="w-9 h-9"
                    strokeWidth={1.5}
                    color={rating !== null && n <= rating ? '#d2682f' : '#c4c4c4'}
                    fill={rating !== null && n <= rating ? '#d2682f' : 'none'}
                  />
                </button>
              ))}
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="What worked, or didn't? Any language is fine."
              aria-label="Your feedback"
              className="w-full rounded-xl bg-[#f2f2f2] p-3 text-base text-[#111111] placeholder:text-[#8a8a8a] resize-none mb-3"
            />
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email, only if you'd like a reply"
              aria-label="Your email (optional)"
              className="w-full rounded-xl bg-[#f2f2f2] p-3 text-base text-[#111111] placeholder:text-[#8a8a8a] mb-4"
            />

            {failed && (
              <p className="text-sm text-[#b3261e] mb-3" role="alert">
                Couldn't send that. Check your connection and try again.
              </p>
            )}

            <div className="flex gap-3">
              <button type="button" onClick={notNow} className="lt-secondary flex-1 !min-h-[48px]">
                Not now
              </button>
              <button type="button" onClick={send} disabled={!canSend} className="lt-primary flex-1 !min-h-[48px]">
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}
