import { motion } from 'framer-motion'
import { Trophy, ArrowRight, Flame, Home } from 'lucide-react'
import { useStore } from '../store'
import { DotRing } from '../conversation/ui/DotRing'

export function CompletionScreen() {
  const { setScreen, speakingTime, targetTime, streak } = useStore()

  const completedFull = speakingTime >= targetTime
  const minutes = Math.floor(speakingTime / 60000)
  const seconds = Math.floor((speakingTime % 60000) / 1000)
  const targetMinutes = Math.round(targetTime / 60000)
  const targetMinutesLabel = `${targetMinutes} minute${targetMinutes === 1 ? '' : 's'}`

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full flex flex-col items-center justify-between p-6 relative z-10 bg-white text-[#111111]"
    >
      {/* Celebration animation */}
      <div className="flex-1 flex flex-col items-center justify-center">
        {/* Success icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', delay: 0.2 }}
          className="relative w-32 h-32 mb-8"
        >
          {/* The avatar ring: solid when the daily goal is reached, dashed when it is not yet */}
          <svg viewBox="0 0 120 120" className="absolute inset-0" aria-hidden="true">
            {completedFull ? (
              <circle cx="60" cy="60" r="56" fill="none" stroke="#c4c4c4" strokeWidth="8" strokeLinecap="round" />
            ) : (
              <DotRing color="#c4c4c4" />
            )}
          </svg>
          <div className="absolute inset-[10px] rounded-full bg-[#f3f3f3] flex items-center justify-center">
            <Trophy className="w-12 h-12 text-[#262626]" strokeWidth={1.5} />
          </div>
        </motion.div>

        {/* Congratulations */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-center"
        >
          {completedFull ? (
            <>
              <h1 className="font-display text-4xl font-semibold mb-4 tracking-tight">
                Amazing!
              </h1>
              <p className="lt-muted text-lg mb-2">
                You spoke for {minutes}:{seconds.toString().padStart(2, '0')} straight!
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-4xl font-semibold mb-4 tracking-tight">
                Good effort!
              </h1>
              <p className="lt-muted text-lg mb-2">
                You spoke for {minutes}:{seconds.toString().padStart(2, '0')}
              </p>
              <p className="lt-faint text-sm">
                Complete {targetMinutesLabel} to mark your daily goal
              </p>
            </>
          )}
        </motion.div>

        {/* Streak display */}
        {completedFull && streak > 0 && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="flex items-center gap-3 lt-card px-6 py-4 mt-8"
          >
            <Flame className="w-8 h-8" strokeWidth={1.5} />
            <div>
              <div className="text-3xl font-semibold">{streak}</div>
              <div className="lt-muted text-sm">day streak</div>
            </div>
          </motion.div>
        )}

        {/* Stats */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="grid grid-cols-2 gap-4 mt-8"
        >
          <div className="lt-card !rounded-xl p-4 text-center">
            <div className="text-2xl font-semibold">
              {minutes}:{seconds.toString().padStart(2, '0')}
            </div>
            <div className="lt-faint text-sm">Speaking time</div>
          </div>
          <div className="lt-card !rounded-xl p-4 text-center">
            <div className="text-2xl font-semibold">
              {Math.min(100, Math.round((speakingTime / targetTime) * 100))}%
            </div>
            <div className="lt-faint text-sm">Completed</div>
          </div>
        </motion.div>
      </div>

      {/* Action buttons */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1 }}
        className="w-full space-y-3 pb-4"
      >
        <button
          onClick={() => setScreen('improvements')}
          className="lt-primary"
        >
          See what you can improve
          <ArrowRight className="w-5 h-5" />
        </button>
        
        <button
          onClick={() => {
            useStore.getState().resetSession()
            setScreen('home')
          }}
          className="lt-secondary"
        >
          <Home className="w-5 h-5" />
          Back to home
        </button>
      </motion.div>
    </motion.div>
  )
}


