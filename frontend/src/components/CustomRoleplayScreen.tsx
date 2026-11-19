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
        <h2 className="font-display text-3xl font-semibold mb-2 tracking-tight">Custom scenario</h2>
        <p className="lt-muted">Describe the situation you want to practice</p>
      </div>

      {/* Input */}
      <div className="flex-1 flex flex-col">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe the situation (e.g. conversation at the local municipal office)"
          className="flex-1 lt-card p-4 text-[#111111] placeholder-[#767676] resize-none focus:outline-none focus:!border-[#111111] text-base"
          autoFocus
        />

        {/* Start Button */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={handleStart}
          disabled={!input.trim()}
          className="lt-primary mt-6"
        >
          <Play className="w-5 h-5" fill="currentColor" />
          Start role-play
        </motion.button>
      </div>
    </motion.div>
  )
}


