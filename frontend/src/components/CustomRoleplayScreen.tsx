import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Play } from 'lucide-react'
import { useStore } from '../store'

export function CustomRoleplayScreen() {
  const { setScreen, setCustomScenario, setSelectedRoleplayId } = useStore()
  const [input, setInput] = useState('')

  const handleBack = () => {
    setScreen('roleplay')
  }

  const handleStart = () => {
    if (input.trim()) {
      setCustomScenario(input.trim())
      setSelectedRoleplayId(null)
      setScreen('conversation')
    }
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
        <h2 className="font-display text-3xl font-bold mb-2">Custom Scenario</h2>
        <p className="text-surface-400">Describe the situation you want to practice</p>
      </div>

      {/* Input */}
      <div className="flex-1 flex flex-col">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe the situation (e.g. conversation at the local municipal office)"
          className="flex-1 glass rounded-2xl p-4 text-white placeholder-surface-500 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
          autoFocus
        />

        {/* Start Button */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={handleStart}
          disabled={!input.trim()}
          className="w-full btn-primary rounded-2xl py-5 flex items-center justify-center gap-3 font-semibold text-lg text-white shadow-lg mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play className="w-6 h-6" fill="currentColor" />
          Start Role-play
        </motion.button>
      </div>
    </motion.div>
  )
}

