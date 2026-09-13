import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'

// Fixed notification id for "tonight's reminder" - scheduling with the same id
// replaces any previously pending one instead of stacking duplicates, so we
// never need to track "did I already schedule one today" ourselves.
const TONIGHT_REMINDER_ID = 1001

// The hour (24h, local device time) the reminder fires at, if the goal isn't
// hit yet by then. Local notifications use the device's own clock, so this is
// correct per-user local time with no timezone tracking on our end.
const REMINDER_HOUR = 20

export const NOTIF_PROMPT_SEEN_KEY = 'lingoa_notif_prompt_seen'

export function hasSeenNotificationPrompt(): boolean {
  try {
    return localStorage.getItem(NOTIF_PROMPT_SEEN_KEY) === '1'
  } catch {
    return true // fail closed: if storage is unavailable, don't keep re-prompting
  }
}

export function markNotificationPromptSeen(): void {
  try {
    localStorage.setItem(NOTIF_PROMPT_SEEN_KEY, '1')
  } catch {
    // ignore - worst case we ask again next time
  }
}

/**
 * Shows the real OS permission dialog. Only call this after the user has
 * already opted in via our own custom pre-permission screen (NotificationPrompt) -
 * iOS will not re-prompt after a real denial, so we don't want to burn that
 * on a cold ask.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const result = await LocalNotifications.requestPermissions()
    return result.display === 'granted'
  } catch (err) {
    console.error('[Notifications] requestPermissions failed:', err)
    return false
  }
}

async function isPermissionGranted(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const result = await LocalNotifications.checkPermissions()
    return result.display === 'granted'
  } catch (err) {
    console.error('[Notifications] checkPermissions failed:', err)
    return false
  }
}

function buildReminderCopy(streak: number, targetLanguage: string, targetMinutes: number) {
  const langName = LANGUAGE_DISPLAY_NAMES[targetLanguage] || targetLanguage
  if (streak > 0) {
    return {
      title: 'Keep your streak alive 🔥',
      body: `Don't lose your ${streak}-day streak — ${targetMinutes} min of ${langName} left today.`,
    }
  }
  return {
    title: 'Time to talk?',
    body: `Got a minute? Your ${langName} partner's ready when you are.`,
  }
}

// Small display-name map for reminder copy - the store's LANGUAGES list carries
// this too, but importing it here would pull the whole store module into a
// helper that doesn't otherwise need it. Kept intentionally in sync by hand;
// low-risk since new languages are added rarely.
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', nl: 'Dutch',
  it: 'Italian', pt: 'Portuguese', hi: 'Hindi', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
}

/**
 * (Re)schedules tonight's reminder for REMINDER_HOUR local time, replacing any
 * previously scheduled one. No-ops if permission isn't granted, or if
 * REMINDER_HOUR has already passed today (nothing left to remind about).
 */
export async function scheduleTonightReminder(params: {
  streak: number
  targetLanguage: string
  targetMinutes: number
}): Promise<void> {
  if (!(await isPermissionGranted())) return

  const now = new Date()
  const at = new Date(now)
  at.setHours(REMINDER_HOUR, 0, 0, 0)
  if (at.getTime() <= now.getTime()) {
    // Already past tonight's reminder time - nothing to schedule for today.
    return
  }

  const { title, body } = buildReminderCopy(params.streak, params.targetLanguage, params.targetMinutes)

  try {
    await LocalNotifications.schedule({
      notifications: [{ id: TONIGHT_REMINDER_ID, title, body, schedule: { at } }],
    })
  } catch (err) {
    console.error('[Notifications] schedule failed:', err)
  }
}

/** Cancels tonight's reminder - call the moment the daily goal is actually hit. */
export async function cancelTonightReminder(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: TONIGHT_REMINDER_ID }] })
  } catch (err) {
    console.error('[Notifications] cancel failed:', err)
  }
}

/**
 * Registers the tap listener once (call on app startup). Returns an unsubscribe
 * function. Fires `onTap` when the user opens the app by tapping the reminder -
 * the one reliable signal that the feature is actually bringing someone back.
 */
export function listenForNotificationTaps(onTap: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}
  const handlePromise = LocalNotifications.addListener('localNotificationActionPerformed', () => {
    onTap()
  })
  return () => {
    handlePromise.then((handle) => handle.remove()).catch(() => {})
  }
}
