import { motion } from 'framer-motion'
import { Volume2, ChevronDown, ChevronUp } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { Correction } from '../store'

interface CorrectionCardProps {
  correction: Correction
  onDismiss: () => void
  onExpandChange?: (expanded: boolean) => void  // Callback when expansion state changes
}

export function CorrectionCard({ correction, onDismiss, onExpandChange }: CorrectionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const isDismissingRef = useRef(false)

  // Notify parent when expansion state changes
  useEffect(() => {
    onExpandChange?.(isExpanded)
  }, [isExpanded, onExpandChange])

  const playAudio = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!correction.audioUrl || isPlaying) return
    
    setIsPlaying(true)
    const audio = new Audio(correction.audioUrl)
    
    audio.onended = () => setIsPlaying(false)
    audio.onerror = () => setIsPlaying(false)
    
    audio.play().catch(() => setIsPlaying(false))
  }

  const toggleExpand = () => {
    setIsExpanded(!isExpanded)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="w-full"
    >
      {/* Collapsed view - just a hint */}
      <div 
        onClick={toggleExpand}
        className="flex items-center gap-2 px-4 py-2 bg-amber-900/30 border border-amber-500/20 rounded-lg cursor-pointer hover:bg-amber-900/40 transition-colors"
      >
        <span className="text-amber-200 text-sm flex-1 truncate">
          Better: "{correction.corrected}"
        </span>
        <button className="text-amber-400 text-xs flex items-center gap-1 hover:text-amber-300">
          {isExpanded ? (
            <>Less <ChevronUp className="w-3 h-3" /></>
          ) : (
            <>More <ChevronDown className="w-3 h-3" /></>
          )}
        </button>
      </div>

      {/* Expanded view */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-2 p-4 bg-amber-900/20 border border-amber-500/20 rounded-lg space-y-3"
        >
          {/* Original */}
          <div>
            <span className="text-xs text-amber-400/70 uppercase tracking-wide">You said</span>
            <p className="text-amber-100/60 line-through decoration-amber-500/50 text-sm mt-1">
              {correction.original}
            </p>
          </div>

          {/* Corrected with audio */}
          <div>
            <span className="text-xs text-emerald-400/90 uppercase tracking-wide">Try this</span>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-white font-medium flex-1">
                {correction.corrected}
              </p>
              {correction.audioUrl && (
                <button
                  onClick={playAudio}
                  disabled={isPlaying}
                  className={`p-2 rounded-full transition-colors ${
                    isPlaying 
                      ? 'bg-emerald-500 text-white' 
                      : 'bg-emerald-600/60 hover:bg-emerald-500 text-white'
                  }`}
                >
                  <Volume2 className={`w-4 h-4 ${isPlaying ? 'animate-pulse' : ''}`} />
                </button>
              )}
            </div>
          </div>

          {/* Explanation */}
          <div className="pt-2 border-t border-amber-500/20">
            <p className="text-sm text-amber-200/80 leading-relaxed">
              {correction.explanation}
            </p>
          </div>

          {/* Dismiss */}
          <button 
            onClick={(e) => {
              e.stopPropagation() // Prevent triggering parent onClick
              if (isDismissingRef.current) return // Prevent multiple clicks
              isDismissingRef.current = true
              onDismiss()
              // Reset after a short delay
              setTimeout(() => {
                isDismissingRef.current = false
              }, 300)
            }}
            className="text-xs text-amber-400/50 hover:text-amber-400 transition-colors"
          >
            Dismiss
          </button>
        </motion.div>
      )}
    </motion.div>
  )
}
