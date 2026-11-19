import { motion } from 'framer-motion'
import { ArrowLeft, MessageSquare, Users } from 'lucide-react'
import { useStore } from '../store'
import { unlockAudio, useApi } from '../hooks/useApi'

export function ModeSelectionScreen() {
  const { setScreen } = useStore()
  const { logEvent } = useApi()

  const handleBack = () => {
    setScreen('home')
  }

  const handleTopics = () => {
    logEvent('mode_selected', { mode: 'topics' })
    // Unlock audio in background (non-blocking)
    unlockAudio().catch(err => console.warn('Audio unlock failed:', err))
    setScreen('topics')
  }

  const handleRoleplay = () => {
    logEvent('mode_selected', { mode: 'roleplay' })
    // Unlock audio in background (non-blocking)
    unlockAudio().catch(err => console.warn('Audio unlock failed:', err))
    setScreen('roleplay')
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full relative z-10 bg-white text-[#111111] p-6 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center mb-8">
        <button
          onClick={handleBack}
          className="lt-back"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>

      {/* Title */}
      <div className="text-center mb-8">
        <h2 className="font-display text-3xl font-semibold mb-2 tracking-tight">Choose your practice</h2>
        <p className="lt-muted">Pick how you want to practice</p>
      </div>

      {/* Mode Options */}
      <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
        {/* Topics Option */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onClick={handleTopics}
          className="lt-card p-5 text-left"
        >
          <div className="flex items-start gap-4">
            <div className="lt-tile">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-1">Free conversation</h3>
              <p className="lt-muted text-sm">
                Chat naturally about topics you choose
              </p>
            </div>
          </div>
        </motion.button>

        {/* Role-play Option */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          onClick={handleRoleplay}
          className="lt-card p-5 text-left"
        >
          <div className="flex items-start gap-4">
            <div className="lt-tile">
              <Users className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-1">Role-play</h3>
              <p className="lt-muted text-sm">
                Practice real-life situations like ordering coffee or talking to colleagues
              </p>
            </div>
          </div>
        </motion.button>
      </div>
    </motion.div>
  )
}


