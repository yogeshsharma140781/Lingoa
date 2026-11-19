import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Pause, Home, Lightbulb, Volume2 } from 'lucide-react'
import { useStore } from '../store'
import { useApi } from '../hooks/useApi'

export function ImprovementsScreen() {
  const { setScreen, improvements, resetSession } = useStore()
  const { generateImprovementAudio } = useApi()
  
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [audioUrls, setAudioUrls] = useState<Record<number, string>>({})
  const [audioElements, setAudioElements] = useState<Record<number, HTMLAudioElement>>({})

  const playAudio = async (index: number, text: string) => {
    // Stop currently playing audio
    if (playingIndex !== null && audioElements[playingIndex]) {
      audioElements[playingIndex].pause()
      audioElements[playingIndex].currentTime = 0
    }

    // If clicking on currently playing, just stop
    if (playingIndex === index) {
      setPlayingIndex(null)
      return
    }

    // Generate audio if not cached
    let url = audioUrls[index]
    if (!url) {
      url = await generateImprovementAudio(text) || ''
      if (url) {
        setAudioUrls(prev => ({ ...prev, [index]: url }))
      }
    }

    if (url) {
      let audio = audioElements[index]
      if (!audio) {
        audio = new Audio(url)
        audio.onended = () => setPlayingIndex(null)
        setAudioElements(prev => ({ ...prev, [index]: audio }))
      }
      
      setPlayingIndex(index)
      audio.play()
    }
  }

  const handleGoHome = () => {
    // Cleanup audio
    Object.values(audioUrls).forEach(url => URL.revokeObjectURL(url))
    Object.values(audioElements).forEach(audio => {
      audio.pause()
    })
    resetSession()
    setScreen('home')
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full flex flex-col relative z-10 bg-white text-[#111111]"
    >
      {/* Header */}
      <div className="p-6 pt-4">
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex items-center gap-3 mb-2"
        >
          <div className="lt-tile">
            <Lightbulb className="w-5 h-5" />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Better ways to say it
          </h1>
        </motion.div>
        <p className="lt-muted">
          Here are some more natural alternatives
        </p>
      </div>

      {/* Improvements list */}
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {improvements.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
          >
            <div className="w-16 h-16 rounded-full bg-[#f2f2f2] flex items-center justify-center mx-auto mb-4">
              <Lightbulb className="w-8 h-8 text-[#6b6b6b]" />
            </div>
            <p className="lt-muted">
              No specific improvements this time!
            </p>
            <p className="lt-faint text-sm mt-2">
              Keep practicing and we'll find ways to help
            </p>
          </motion.div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {improvements.map((improvement, index) => (
                <motion.div
                  key={index}
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: index * 0.1 }}
                  className="lt-card p-5"
                >
                  {/* What you said */}
                  <div className="mb-4">
                    <span className="lt-faint text-xs uppercase tracking-wider mb-1 block">
                      What you said
                    </span>
                    <p className="lt-muted italic">
                      "{improvement.original}"
                    </p>
                  </div>

                  {/* Arrow */}
                  <div className="flex items-center gap-2 mb-4">
                    <ArrowRight className="w-4 h-4" />
                    <span className="text-sm font-medium">
                      Try this instead
                    </span>
                  </div>

                  {/* Better way */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-medium text-lg">
                        "{improvement.better}"
                      </p>
                      {improvement.context && (
                        <p className="lt-muted text-sm mt-2">
                          {improvement.context}
                        </p>
                      )}
                    </div>

                    {/* Play button */}
                    <button
                      onClick={() => playAudio(index, improvement.better)}
                      aria-label={playingIndex === index ? 'Stop' : 'Hear this'}
                      className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                        playingIndex === index
                          ? 'bg-[#d9d9d9] text-[#111111]'
                          : 'bg-[#f0f0f0] text-[#222222] active:bg-[#e2e2e2]'
                      }`}
                    >
                      {playingIndex === index ? (
                        <Pause className="w-5 h-5" fill="currentColor" />
                      ) : (
                        <Volume2 className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Bottom action */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="p-6 pb-4"
      >
        <button
          onClick={handleGoHome}
          className="lt-primary"
        >
          <Home className="w-5 h-5" />
          Done for today
        </button>
      </motion.div>
    </motion.div>
  )
}

