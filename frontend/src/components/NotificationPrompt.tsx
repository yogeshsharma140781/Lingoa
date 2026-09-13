import { motion } from 'framer-motion'
import { Bell, Flame } from 'lucide-react'
import { useStore } from '../store'
import { useApi } from '../hooks/useApi'
import {
  markNotificationPromptSeen,
  requestNotificationPermission,
  scheduleTonightReminder,
} from '../hooks/useNotifications'

// Custom pre-permission screen, shown once right after a user's first
// completed daily goal. iOS won't re-prompt after a real OS-level denial, so
// we ask softly here first - only "Enable" triggers the actual system dialog.
export function NotificationPrompt({ onDismiss }: { onDismiss: () => void }) {
  const { streak, targetLanguage, targetTime } = useStore()
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
      await scheduleTonightReminder({ streak, targetLanguage, targetMinutes })
    }
    finish()
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-end justify-center p-4"
      onClick={finish}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-md glass rounded-2xl p-6 border border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-full bg-primary-500/20 flex items-center justify-center mb-4">
          <Bell className="w-6 h-6 text-primary-400" />
        </div>

        <h3 className="font-display text-xl font-bold mb-2">
          Never lose your streak
        </h3>
        <p className="text-surface-400 text-sm mb-5 leading-relaxed">
          {streak > 0 ? (
            <>We'll only remind you in the evening, and only if you haven't practiced yet that day.</>
          ) : (
            <>Want a nudge in the evening if you haven't practiced yet that day? Only when it's useful, never more than once a day.</>
          )}
        </p>

        {streak > 0 && (
          <div className="flex items-center gap-2 mb-5 text-sm text-primary-400">
            <Flame className="w-4 h-4" />
            <span>{streak}-day streak going</span>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={finish}
            className="flex-1 glass rounded-xl py-3 font-medium text-surface-400 hover:bg-white/10 transition-colors"
          >
            Not now
          </button>
          <button
            onClick={handleEnable}
            className="flex-1 btn-primary rounded-xl py-3 font-semibold text-white"
          >
            Enable
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
