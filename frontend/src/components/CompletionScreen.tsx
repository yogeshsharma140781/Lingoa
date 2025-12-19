import { motion } from 'framer-motion'
import { Trophy, ArrowRight, Flame, Home } from 'lucide-react'
import { useStore } from '../store'

export function CompletionScreen() {
  const { setScreen, speakingTime, targetTime, streak } = useStore()

  const completedFull = speakingTime >= targetTime
  const minutes = Math.floor(speakingTime / 60000)
  const seconds = Math.floor((speakingTime % 60000) / 1000)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full flex flex-col items-center justify-between p-6 relative z-10"
    >
      {/* Celebration animation */}
      <div className="flex-1 flex flex-col items-center justify-center">
        {/* Success icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', delay: 0.2 }}
          className={`w-32 h-32 rounded-full flex items-center justify-center mb-8 ${
            completedFull 
              ? 'bg-gradient-to-br from-accent-400 to-accent-600 glow-accent' 
              : 'bg-gradient-to-br from-primary-400 to-primary-600 glow-primary'
          }`}
        >
          <Trophy className="w-16 h-16 text-white" />
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
              <h1 className="font-display text-4xl font-bold mb-4">
                Amazing! 🎉
              </h1>
              <p className="text-surface-300 text-lg mb-2">
                You spoke for 5 minutes straight!
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-4xl font-bold mb-4">
                Good effort! 💪
              </h1>
              <p className="text-surface-300 text-lg mb-2">
                You spoke for {minutes}:{seconds.toString().padStart(2, '0')}
              </p>
              <p className="text-surface-500 text-sm">
                Complete 5 minutes to mark your daily goal
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
            className="flex items-center gap-3 glass rounded-2xl px-6 py-4 mt-8"
          >
            <Flame className="w-8 h-8 text-primary-400" />
            <div>
              <div className="text-3xl font-bold">{streak}</div>
              <div className="text-surface-400 text-sm">day streak!</div>
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
          <div className="glass rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-primary-400">
              {minutes}:{seconds.toString().padStart(2, '0')}
            </div>
            <div className="text-surface-500 text-sm">Speaking time</div>
          </div>
          <div className="glass rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-accent-400">
              {Math.round((speakingTime / targetTime) * 100)}%
            </div>
            <div className="text-surface-500 text-sm">Completed</div>
          </div>
        </motion.div>
      </div>

      {/* Action buttons */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1 }}
        className="w-full space-y-3 pb-8"
      >
        <button
          onClick={() => setScreen('improvements')}
          className="w-full btn-primary rounded-2xl py-5 flex items-center justify-center gap-3 font-semibold text-lg text-white"
        >
          See What You Can Improve
          <ArrowRight className="w-5 h-5" />
        </button>
        
        <button
          onClick={() => {
            useStore.getState().resetSession()
            setScreen('home')
          }}
          className="w-full glass rounded-2xl py-4 flex items-center justify-center gap-2 font-medium text-surface-300 hover:bg-white/10 transition-colors"
        >
          <Home className="w-5 h-5" />
          Back to Home
        </button>
      </motion.div>
    </motion.div>
  )
}


