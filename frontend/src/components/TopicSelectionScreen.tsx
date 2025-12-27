import { motion } from 'framer-motion'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { useStore, TOPICS } from '../store'
import { unlockAudio } from '../hooks/useApi'

export function TopicSelectionScreen() {
  const { 
    setScreen, 
    setSelectedTopic, 
    lastTopic,
  } = useStore()

  const handleTopicSelect = (topicId: string) => {
    // Unlock audio in background (non-blocking) - will be ready by conversation time
    unlockAudio().catch(err => console.warn('Audio unlock failed:', err))
    setSelectedTopic(topicId)
    setScreen('conversation')
  }

  const handleSkip = () => {
    // Unlock audio in background (non-blocking) - will be ready by conversation time
    unlockAudio().catch(err => console.warn('Audio unlock failed:', err))
    // Random topic if skipped
    const randomTopic = TOPICS[Math.floor(Math.random() * TOPICS.length)]
    setSelectedTopic(randomTopic.id)
    setScreen('conversation')
  }

  const handleBack = () => {
    setScreen('mode')
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-screen bg-surface-900 text-white p-6 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={handleBack}
          className="p-2 hover:bg-surface-800 rounded-full transition-colors"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <button
          onClick={handleSkip}
          className="text-surface-400 hover:text-white text-sm transition-colors"
        >
          Skip
        </button>
      </div>

      {/* Title */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold mb-2">What shall we chat about?</h1>
        <p className="text-surface-400 text-sm">
          Pick a topic to get started, or skip for a surprise
        </p>
      </div>

      {/* Topics Grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3 max-w-md mx-auto pb-4">
          {TOPICS.map((topic, index) => {
            const isLastUsed = topic.id === lastTopic
            
            return (
              <motion.button
                key={topic.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => handleTopicSelect(topic.id)}
                className={`
                  relative p-4 rounded-xl text-left transition-all
                  ${isLastUsed 
                    ? 'bg-surface-800 border border-surface-700' 
                    : 'bg-surface-800/50 hover:bg-surface-800 border border-transparent hover:border-surface-700'
                  }
                `}
              >
                {/* Emoji */}
                <span className="text-3xl mb-2 block">{topic.emoji}</span>
                
                {/* Name */}
                <span className="font-medium block">{topic.name}</span>

                {/* Last used indicator */}
                {isLastUsed && (
                  <span className="absolute top-2 right-2 text-xs text-surface-500">
                    last time
                  </span>
                )}
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* Quick start hint */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-center mt-6"
      >
        <button
          onClick={handleSkip}
          className="inline-flex items-center gap-2 text-primary-400 hover:text-primary-300 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          <span className="text-sm">Or let me surprise you</span>
        </button>
      </motion.div>
    </motion.div>
  )
}

