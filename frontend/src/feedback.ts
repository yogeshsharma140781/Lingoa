// The one-time feedback ask after a learner's first real conversation: remembers that it
// has been dealt with (sent or not now) and sends the answer to the backend, which emails it.

import { API_BASE } from './hooks/useApi'
import { loadAppInfo } from './appInfo'

const KEY = 'lingoa_feedback_asked'

/** Speaking time (ms) that counts as a real first session (not an accidental open). */
export const MIN_SPEAKING_MS_FOR_FEEDBACK = 20_000

export function hasBeenAskedForFeedback(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true // when storage is unavailable, never nag
  }
}

export function markFeedbackAsked(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // nothing to do
  }
}

export interface FeedbackInput {
  userId: string
  targetLanguage: string
  /** 1 to 5 stars, or null when they only wrote a message. */
  rating: number | null
  message: string
  email: string
}

/** Resolves true when the backend accepted it. */
export async function sendFeedback(input: FeedbackInput): Promise<boolean> {
  try {
    const { version, platform } = await loadAppInfo()
    const res = await fetch(`${API_BASE}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: input.userId,
        rating: input.rating,
        message: input.message.trim(),
        email: input.email.trim() || null,
        target_language: input.targetLanguage,
        app_version: version,
        platform,
      }),
    })
    return res.ok
  } catch (err) {
    console.warn('[Feedback] Could not send:', err)
    return false
  }
}
