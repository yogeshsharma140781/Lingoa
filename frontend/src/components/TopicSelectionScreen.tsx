import { motion } from 'framer-motion'
import { ArrowLeft, Sparkles, Sun, UtensilsCrossed, Briefcase, Users, Plane, Gamepad2, PartyPopper, Dices, type LucideIcon } from 'lucide-react'
import { useStore, TOPICS } from '../store'
import { unlockAudio } from '../hooks/useApi'

// Line icons keep the screen in greys (the topics' colour emoji would not).
const TOPIC_ICONS: Record<string, LucideIcon> = {
  daily: Sun,
  food: UtensilsCrossed,
  work: Briefcase,
  family: Users,
  travel: Plane,
  hobbies: Gamepad2,
  weekend: PartyPopper,
  random: Dices,
}

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
      className="h-full relative z-10 bg-white text-[#111111] p-6 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={handleBack}
          className="lt-back"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button
          onClick={handleSkip}
          className="lt-text-btn"
        >
          Skip
        </button>
      </div>

      {/* Title */}
      <div className="text-center mb-8">
        <h1 className="font-display text-3xl font-semibold mb-2 tracking-tight">What shall we chat about?</h1>
        <p className="lt-muted text-sm">
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
                className={`lt-card relative p-4 text-left flex flex-col items-start justify-start ${isLastUsed ? '!border-[#111111]' : ''}`}
              >
                {/* Icon */}
                {(() => {
                  const Icon = TOPIC_ICONS[topic.id] ?? Sparkles
                  return <span className="lt-tile mb-3"><Icon className="w-5 h-5" /></span>
                })()}
                
                {/* Name */}
                <span className="font-medium block">{topic.name}</span>

                {/* Last used indicator */}
                {isLastUsed && (
                  <span className="absolute top-3 right-3 text-xs lt-faint">
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
          className="lt-text-btn inline-flex items-center gap-2 no-underline"
        >
          <Sparkles className="w-4 h-4" />
          <span>Or let me surprise you</span>
        </button>
      </motion.div>
    </motion.div>
  )
}

