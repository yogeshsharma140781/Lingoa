import { motion } from 'framer-motion'
import { ArrowLeft, MessageSquare, Users } from 'lucide-react'
import { useStore } from '../store'
import { unlockAudio } from '../hooks/useApi'

export function ModeSelectionScreen() {
  const { setScreen } = useStore()

  const handleBack = () => {
    setScreen('home')
  }

  const handleTopics = () => {
    unlockAudio()
    setScreen('topics')
  }

  const handleRoleplay = () => {
    unlockAudio()
    setScreen('roleplay')
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-screen bg-surface-900 text-white p-6 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center mb-8">
        <button
          onClick={handleBack}
          className="p-2 hover:bg-surface-800 rounded-full transition-colors"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
      </div>

      {/* Title */}
      <div className="text-center mb-8">
        <h2 className="font-display text-3xl font-bold mb-2">Choose Your Practice</h2>
        <p className="text-surface-400">Pick how you want to practice</p>
      </div>

      {/* Mode Options */}
      <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
        {/* Topics Option */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onClick={handleTopics}
          className="glass rounded-2xl p-6 text-left hover:bg-white/5 transition-colors"
        >
          <div className="flex items-start gap-4">
            <div className="p-3 bg-primary-500/20 rounded-xl">
              <MessageSquare className="w-6 h-6 text-primary-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-1">Free Conversation</h3>
              <p className="text-surface-400 text-sm">
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
          className="glass rounded-2xl p-6 text-left hover:bg-white/5 transition-colors"
        >
          <div className="flex items-start gap-4">
            <div className="p-3 bg-accent-500/20 rounded-xl">
              <Users className="w-6 h-6 text-accent-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-1">Role-play</h3>
              <p className="text-surface-400 text-sm">
                Practice real-life situations like ordering coffee or talking to colleagues
              </p>
            </div>
          </div>
        </motion.button>
      </div>
    </motion.div>
  )
}

