import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Play, ChevronDown, Check, Mic, Globe, X } from 'lucide-react'
import { useStore, LANGUAGES } from '../store'
import { unlockAudio, useApi } from '../hooks/useApi'
import { NotificationPrompt } from './NotificationPrompt'
import { wrapUpMessage, shouldAskFeeling, type SessionWrapUp } from '../encouragement'

export function HomeScreen() {
  const {
    setScreen,
    streak,
    completedToday,
    targetLanguage,
    setTargetLanguage,
    targetTime,
    pendingNotificationPrompt,
    setPendingNotificationPrompt,
    sessionWrapUp,
    setSessionWrapUp,
  } = useStore()

  const [showLanguages, setShowLanguages] = useState(false)
  const { logEvent } = useApi()

  // Sometimes the kind word also asks how the conversation felt.
  const [askFeeling, setAskFeeling] = useState(false)
  const [feelingAnswered, setFeelingAnswered] = useState(false)
  const handledWrapUpRef = useRef<SessionWrapUp | null>(null)
  useEffect(() => {
    if (!sessionWrapUp || handledWrapUpRef.current === sessionWrapUp) return
    handledWrapUpRef.current = sessionWrapUp
    setAskFeeling(shouldAskFeeling())
    setFeelingAnswered(false)
  }, [sessionWrapUp])

  const answerFeeling = (feeling: 'hard' | 'ok' | 'great') => {
    if (!sessionWrapUp || feelingAnswered) return
    logEvent('session_feeling', {
      feeling,
      hit_goal: sessionWrapUp.hitGoal,
      speaking_ms: Math.round(sessionWrapUp.speakingMs),
    })
    setFeelingAnswered(true)
  }

  // The kind word from the conversation they just left fades on its own
  // (a little later when it's asking a question, and right after it's answered).
  useEffect(() => {
    if (!sessionWrapUp) return
    const ms = feelingAnswered ? 1500 : askFeeling ? 12000 : 7000
    const id = window.setTimeout(() => setSessionWrapUp(null), ms)
    return () => window.clearTimeout(id)
  }, [sessionWrapUp, askFeeling, feelingAnswered, setSessionWrapUp])

  const currentLanguage = LANGUAGES.find(l => l.code === targetLanguage) || LANGUAGES[0]
  const targetMinutes = Math.round(targetTime / 60000)
  const wrapUpText = sessionWrapUp
    ? wrapUpMessage(sessionWrapUp, LANGUAGES.find(l => l.code === sessionWrapUp.languageCode)?.name ?? 'your language')
    : null
  const targetMinutesLabel = `${targetMinutes} minute${targetMinutes === 1 ? '' : 's'}`

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full flex flex-col items-center justify-between p-6 relative z-10"
    >
      {/* Header */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="w-full flex items-center justify-between pt-4"
      >
        {/* Streak */}
        <div className="flex items-center gap-2 glass rounded-full px-4 py-2">
          <Flame className={`w-5 h-5 ${streak > 0 ? 'text-primary-400' : 'text-surface-500'}`} />
          <span className="font-semibold text-lg">{streak}</span>
          <span className="text-surface-400 text-sm">day streak</span>
        </div>

        {/* Today's status */}
        {completedToday && (
          <div className="flex items-center gap-2 bg-accent-500/20 text-accent-400 rounded-full px-4 py-2">
            <Check className="w-4 h-4" />
            <span className="text-sm font-medium">Done today!</span>
          </div>
        )}
      </motion.div>

      {/* Main content */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex flex-col items-center text-center"
      >
        {/* Logo/Title */}
        <motion.div
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="mb-8"
        >
          <div className="w-20 h-20 flex items-center justify-center mb-6">
            <Mic className="w-16 h-16 text-primary-400 opacity-80" strokeWidth={1.5} />
          </div>
        </motion.div>

        <h1 className="font-display text-5xl font-bold mb-4">
          <span className="text-gradient">Lingoa</span>
        </h1>
        <p className="text-surface-400 text-lg max-w-xs mb-8">
          Practice language by speaking for {targetMinutesLabel}. Every day. No lessons, just conversations.
        </p>

        {/* Language selector */}
        <div className="relative mb-8">
          <button
            onClick={() => setShowLanguages(!showLanguages)}
            className="flex items-center gap-3 glass rounded-2xl px-5 py-3 hover:bg-white/5 transition-colors"
          >
            <Globe className="w-5 h-5 text-surface-400" />
            <span className="text-2xl">{currentLanguage.flag}</span>
            <span className="font-medium">{currentLanguage.name}</span>
            <ChevronDown className={`w-4 h-4 text-surface-400 transition-transform ${showLanguages ? 'rotate-180' : ''}`} />
          </button>

          {/* Language dropdown */}
          <AnimatedDropdown show={showLanguages}>
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  setTargetLanguage(lang.code)
                  setShowLanguages(false)
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors ${
                  lang.code === targetLanguage ? 'bg-primary-500/20' : ''
                }`}
              >
                <span className="text-xl">{lang.flag}</span>
                <span className="font-medium">{lang.name}</span>
                {lang.code === targetLanguage && (
                  <Check className="w-4 h-4 text-primary-400 ml-auto" />
                )}
              </button>
            ))}
          </AnimatedDropdown>
        </div>
      </motion.div>

      {/* Start button */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="w-full pb-8"
      >
        <button
          onClick={() => {
            // Unlock audio in background (non-blocking) - it will be ready by conversation time
            unlockAudio().catch(err => console.warn('Audio unlock failed:', err))
            setScreen('mode')
          }}
          className="w-full btn-primary rounded-2xl py-5 flex items-center justify-center gap-3 font-semibold text-lg text-white shadow-lg"
        >
          <Play className="w-6 h-6" fill="currentColor" />
          {completedToday ? 'Practice Again' : 'Start Talking'}
        </button>

        <p className="text-center text-surface-500 text-sm mt-4">
          Speak for {targetMinutesLabel} to complete your daily goal
        </p>
      </motion.div>

      {/* Kind word after a conversation (skipped when the reminder prompt is up, which has its own moment) */}
      <AnimatePresence>
        {sessionWrapUp && !pendingNotificationPrompt && (
          <motion.div
            key="wrap-up"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="absolute top-28 inset-x-6 z-20 glass rounded-2xl px-4 py-3 text-left border border-accent-500/30"
          >
            <button
              onClick={() => setSessionWrapUp(null)}
              className="absolute top-2 right-2 p-1.5 rounded-full text-surface-500 hover:text-surface-300 transition-colors"
              aria-label="Dismiss"
              type="button"
            >
              <X className="w-4 h-4" />
            </button>
            <p className="text-accent-400 text-sm font-semibold pr-6">{wrapUpText?.title}</p>
            <p className="text-surface-200 text-sm mt-0.5 pr-6">{wrapUpText?.body}</p>
            {askFeeling && (
              feelingAnswered ? (
                <p className="text-surface-400 text-xs mt-3">Thanks, that helps.</p>
              ) : (
                <div className="mt-3">
                  <p className="text-surface-400 text-xs mb-2">How did that feel?</p>
                  <div className="flex gap-2">
                    {([['hard', '😟', 'Hard'], ['ok', '🙂', 'Okay'], ['great', '😀', 'Great']] as const).map(([value, face, label]) => (
                      <button
                        key={value}
                        onClick={() => answerFeeling(value)}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors py-2 text-sm text-surface-200"
                        type="button"
                      >
                        <span aria-hidden="true">{face}</span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingNotificationPrompt && (
          <NotificationPrompt onDismiss={() => setPendingNotificationPrompt(false)} />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function AnimatedDropdown({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      className="absolute top-full left-0 right-0 mt-2 glass rounded-2xl overflow-hidden z-50 max-h-64 overflow-y-auto"
    >
      {children}
    </motion.div>
  )
}

