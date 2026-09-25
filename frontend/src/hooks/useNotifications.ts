import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'
import { REMINDER_DAYS, buildReminderPlan, reminderIdForDate } from './reminderPlan'

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

// Small display-name map for reminder copy - the store's LANGUAGES list carries
// this too, but importing it here would pull the whole store module into a
// helper that doesn't otherwise need it. Kept in sync by hand; new languages
// are added rarely.
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', nl: 'Dutch',
  it: 'Italian', pt: 'Portuguese', hi: 'Hindi', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
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

// Syncs can be triggered from several places at once (app start, stats arriving,
// resume, opt-in). Run them one at a time so a cancel from one can't land in the
// middle of another's schedule.
let syncQueue: Promise<void> = Promise.resolve()

/**
 * Makes the OS's pending reminders match the current state: the next week of
 * 8pm evenings, minus today's if the goal is already done. Safe to call as often
 * as you like - it always cancels the whole window first, then re-schedules.
 *
 * Because these are OS-level timers, an evening on which the app is never opened
 * still gets its reminder. That's the case a single same-day reminder missed.
 */
export function syncReminders(params: {
  streak: number
  completedToday: boolean
  targetLanguage: string
  targetMinutes: number
}): Promise<void> {
  syncQueue = syncQueue.then(async () => {
    if (!(await isPermissionGranted())) return

    const now = new Date()
    const plan = buildReminderPlan({
      now,
      streak: params.streak,
      completedToday: params.completedToday,
      languageName: LANGUAGE_DISPLAY_NAMES[params.targetLanguage] || params.targetLanguage,
      targetMinutes: params.targetMinutes,
    })

    // Cancel the whole window (not just what we're about to schedule) so a day
    // that should no longer have a reminder - today's, once the goal is hit -
    // doesn't keep the one scheduled earlier.
    const windowIds = Array.from({ length: REMINDER_DAYS }, (_, offset) => {
      const d = new Date(now)
      d.setDate(d.getDate() + offset)
      return { id: reminderIdForDate(d) }
    })

    try {
      await LocalNotifications.cancel({ notifications: windowIds })
      if (plan.length > 0) {
        await LocalNotifications.schedule({
          notifications: plan.map((r) => ({ id: r.id, title: r.title, body: r.body, schedule: { at: r.at } })),
        })
      }
    } catch (err) {
      console.error('[Notifications] sync failed:', err)
    }
  })
  return syncQueue
}

/** Cancels today's reminder immediately - call the moment the daily goal is hit. */
export function cancelTodayReminder(): Promise<void> {
  syncQueue = syncQueue.then(async () => {
    if (!Capacitor.isNativePlatform()) return
    try {
      await LocalNotifications.cancel({ notifications: [{ id: reminderIdForDate(new Date()) }] })
    } catch (err) {
      console.error('[Notifications] cancel failed:', err)
    }
  })
  return syncQueue
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
