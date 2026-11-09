import { motion } from 'framer-motion'
import { Volume2 } from 'lucide-react'
import { useState } from 'react'
import { Correction } from '../store'

interface CorrectionCardProps {
  correction: Correction
  onDismiss: () => void
  // Plays the corrected sentence. The parent owns playback so it can pause the
  // microphone while the audio plays (otherwise the mic hears it as speech).
  onPlay?: (audioUrl: string) => Promise<void>
}

export function CorrectionCard({ correction, onDismiss, onPlay }: CorrectionCardProps) {
  const [isPlaying, setIsPlaying] = useState(false)

  const playAudio = async () => {
    if (!correction.audioUrl || !onPlay || isPlaying) return
    setIsPlaying(true)
    try {
      await onPlay(correction.audioUrl)
    } finally {
      setIsPlaying(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="w-full p-4 bg-amber-900/20 border border-amber-500/20 rounded-lg space-y-2"
    >
      <span className="text-xs text-amber-400 uppercase tracking-wide">Better way to say it</span>

      <p className="text-white font-medium text-base">{correction.corrected}</p>

      {correction.explanation && (
        <p className="text-sm text-amber-200/80 leading-relaxed">{correction.explanation}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        {correction.audioUrl && onPlay && (
          <button
            onClick={playAudio}
            disabled={isPlaying}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              isPlaying
                ? 'bg-emerald-500 text-white'
                : 'bg-emerald-600/60 hover:bg-emerald-500 text-white'
            }`}
          >
            <Volume2 className={`w-3.5 h-3.5 ${isPlaying ? 'animate-pulse' : ''}`} />
            Hear it
          </button>
        )}
        <button
          onClick={onDismiss}
          className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 hover:bg-white/15 text-amber-100 transition-colors"
        >
          Got it
        </button>
      </div>
    </motion.div>
  )
}
