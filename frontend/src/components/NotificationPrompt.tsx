import { motion } from 'framer-motion'
import { Bell, Flame } from 'lucide-react'
import { useStore } from '../store'
import { useApi } from '../hooks/useApi'
import {
  markNotificationPromptSeen,
  requestNotificationPermission,
  syncReminders,
} from '../hooks/useNotifications'

// Custom pre-permission screen, shown once right after a user's first
// completed daily goal. iOS won't re-prompt after a real OS-level denial, so
// we ask softly here first - only "Enable" triggers the actual system dialog.
export function NotificationPrompt({ onDismiss }: { onDismiss: () => void }) {
  const { streak, completedToday, targetLanguage, targetTime } = useStore()
  const { logEvent } = useApi()
  const targetMinutes = Math.round(targetTime / 60000)

  const finish = () => {
    markNotificationPromptSeen()
    onDismiss()
  }

  const handleEnable = async () => {
    const granted = await requestNotificationPermission()
    logEvent(granted ? 'notification_permission_granted' : 'notification_permission_denied')
    if (granted) {
      await syncReminders({ streak, completedToday, targetLanguage, targetMinutes })
    }
    finish()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-end justify-center p-4 bg-black/30"
      onClick={finish}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-md lt-card p-6 shadow-[0_8px_30px_rgba(0,0,0,0.15)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lt-tile mb-4">
          <Bell className="w-5 h-5" />
        </div>

        <h3 className="font-display text-xl font-semibold mb-2">
          Never lose your streak
        </h3>
        <p className="lt-muted text-sm mb-5 leading-relaxed">
          {streak > 0 ? (
            <>We'll only remind you in the evening, and only if you haven't practiced yet that day.</>
          ) : (
            <>Want a nudge in the evening if you haven't practiced yet that day? Only when it's useful, never more than once a day.</>
          )}
        </p>

        {streak > 0 && (
          <div className="flex items-center gap-2 mb-5 text-sm font-medium">
            <Flame className="w-4 h-4" />
            <span>{streak}-day streak going</span>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={finish}
            className="lt-secondary flex-1 !min-h-[48px]"
          >
            Not now
          </button>
          <button
            onClick={handleEnable}
            className="lt-primary flex-1 !min-h-[48px] !text-base"
          >
            Enable
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
