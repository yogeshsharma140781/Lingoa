import { Flag } from './Flag'
import logo from '../assets/logo.svg'
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Play, ChevronDown, Check, Globe, X } from 'lucide-react'
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
      className="h-full flex flex-col items-center justify-between p-6 relative z-10 bg-white text-[#111111]"
    >
      {/* Header */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="w-full flex items-center justify-between pt-2"
      >
        {/* Streak */}
        <div className="lt-pill px-4 py-2">
          <Flame className={`w-5 h-5 ${streak > 0 ? 'text-[#111111]' : 'text-[#8a8a8a]'}`} />
          <span className="font-semibold text-lg">{streak}</span>
          <span className="lt-muted text-sm">day streak</span>
        </div>

        {/* Today's status */}
        {completedToday && (
          <div className="flex items-center gap-2 rounded-full border border-[#c9c9c9] px-4 py-2">
            <Check className="w-4 h-4" />
            <span className="text-sm font-medium">Done today</span>
          </div>
        )}
      </motion.div>

      {/* Main content */}
      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex flex-col items-center text-center"
      >
        {/* The logo already contains the word "Lingoa" */}
        <h1 className="mb-6">
          <img
            src={logo}
            alt="Lingoa"
            width={688}
            height={412}
            draggable={false}
            className="block w-[min(53vw,210px)] h-auto select-none"
          />
        </h1>
        <p className="lt-muted text-lg max-w-xs mb-8 leading-snug">
          Practice language by speaking for {targetMinutesLabel}. Every day. No lessons, just conversations.
        </p>

        {/* Language selector */}
        <div className="relative mb-8">
          <button
            onClick={() => setShowLanguages(!showLanguages)}
            className="lt-card flex items-center gap-3 px-5 min-h-[52px]"
            aria-expanded={showLanguages}
          >
            <Globe className="w-5 h-5 text-[#555555]" />
            <Flag code={currentLanguage.code} className="w-8" />
            <span className="font-medium">{currentLanguage.name}</span>
            <ChevronDown className={`w-4 h-4 text-[#555555] transition-transform ${showLanguages ? 'rotate-180' : ''}`} />
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
                className={`w-full flex items-center gap-3 px-4 min-h-[48px] active:bg-[#f2f2f2] transition-colors ${
                  lang.code === targetLanguage ? 'bg-[#f5f5f5]' : ''
                }`}
              >
                <Flag code={lang.code} className="w-7" />
                <span className="font-medium">{lang.name}</span>
                {lang.code === targetLanguage && <Check className="w-4 h-4 ml-auto" />}
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
        className="w-full pb-4"
      >
        <button
          onClick={() => {
            // Unlock audio in background (non-blocking) - it will be ready by conversation time
            unlockAudio().catch(err => console.warn('Audio unlock failed:', err))
            setScreen('mode')
          }}
          className="lt-primary"
        >
          <Play className="w-5 h-5" fill="currentColor" />
          {completedToday ? 'Practice Again' : 'Start Talking'}
        </button>

        <p className="text-center lt-faint text-sm mt-4">
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
            className="absolute top-20 inset-x-6 z-20 lt-card px-4 py-3 text-left shadow-[0_8px_30px_rgba(0,0,0,0.08)]"
          >
            <button
              onClick={() => setSessionWrapUp(null)}
              className="absolute top-1 right-1 w-11 h-11 flex items-center justify-center rounded-full lt-faint"
              aria-label="Dismiss"
              type="button"
            >
              <X className="w-4 h-4" />
            </button>
            <p className="text-sm font-semibold pr-10">{wrapUpText?.title}</p>
            <p className="lt-muted text-sm mt-0.5 pr-10">{wrapUpText?.body}</p>
            {askFeeling && (
              feelingAnswered ? (
                <p className="lt-faint text-xs mt-3">Thanks, that helps.</p>
              ) : (
                <div className="mt-3">
                  <p className="lt-faint text-xs mb-2">How did that feel?</p>
                  <div className="flex gap-2">
                    {([['hard', 'Hard'], ['ok', 'Okay'], ['great', 'Great']] as const).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => answerFeeling(value)}
                        className="flex-1 flex items-center justify-center rounded-xl bg-[#f2f2f2] active:bg-[#e2e2e2] transition-colors min-h-[44px] text-sm text-[#262626]"
                        type="button"
                      >
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
      className="absolute top-full left-0 right-0 mt-2 lt-card overflow-hidden z-50 max-h-64 overflow-y-auto shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
    >
      {children}
    </motion.div>
  )
}
