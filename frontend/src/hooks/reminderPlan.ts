// Pure scheduling logic for the evening reminders - no Capacitor imports, so it
// can be tested on its own. useNotifications.ts feeds the result to the OS.

export const REMINDER_HOUR = 20 // 8pm, device-local time
export const REMINDER_DAYS = 7 // how many evenings ahead we keep scheduled

export interface ReminderPlanInput {
  now: Date
  streak: number // effective streak (0 if already broken)
  completedToday: boolean
  languageName: string
  targetMinutes: number
}

export interface PlannedReminder {
  id: number
  at: Date
  title: string
  body: string
}

// One id per calendar day (e.g. 20260924), so "today's reminder" is always
// addressable no matter when it was scheduled. Fits Android's 32-bit id range.
export function reminderIdForDate(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

function eveningOf(now: Date, dayOffset: number): Date {
  const at = new Date(now)
  at.setDate(at.getDate() + dayOffset)
  at.setHours(REMINDER_HOUR, 0, 0, 0)
  return at
}

/**
 * Builds the reminders that should be pending right now: the next REMINDER_DAYS
 * evenings, minus any that are already past, minus today's if the goal is done.
 *
 * They are OS timers, so evenings on which the app is never opened still fire.
 * Only a day the app *is* opened can be cancelled (when the goal gets hit).
 *
 * A streak is only mentioned when it's honest for that evening: today's if the
 * goal isn't done yet, or tomorrow's if it is. Any later evening assumes a missed
 * day in between, so it gets the plain invitation instead.
 */
export function buildReminderPlan(input: ReminderPlanInput): PlannedReminder[] {
  const { now, streak, completedToday, languageName, targetMinutes } = input
  const plan: PlannedReminder[] = []

  for (let offset = 0; offset < REMINDER_DAYS; offset++) {
    const at = eveningOf(now, offset)
    if (at.getTime() <= now.getTime()) continue // this evening already passed
    if (offset === 0 && completedToday) continue // nothing to remind about

    const streakAlive = streak > 0 && ((completedToday && offset === 1) || (!completedToday && offset === 0))

    plan.push({
      id: reminderIdForDate(at),
      at,
      title: streakAlive ? 'Keep your streak alive 🔥' : 'Time to talk?',
      body: streakAlive
        ? `Don't lose your ${streak}-day streak — ${targetMinutes} min of ${languageName} left today.`
        : `Got a minute? Your ${languageName} partner's ready when you are.`,
    })
  }

  return plan
}
