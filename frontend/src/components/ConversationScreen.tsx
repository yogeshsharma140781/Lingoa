import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Volume2, Gauge, MicOff, Mic, Send, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import { useApi } from '../hooks/useApi'
import { useVoiceActivity } from '../hooks/useVoiceActivity'
import { CorrectionCard } from './CorrectionCard'

// Speed options (UI labels - actual speed is mapped in useApi)
const SPEED_OPTIONS = [0.8, 0.9, 1.0]

export function ConversationScreen() {
  const {
    setScreen,
    speakingTime,
    targetTime,
    incrementSpeakingTime,
    resetSpeakingTime,
    isSpeaking,
    isAiSpeaking,
    aiMessage,
    clearAiMessage,
    audioSpeed,
    setAudioSpeed,
    resetSession,
    setMicPermission,
    userTranscript,
    setUserTranscript,
    isProcessing,
    setIsProcessing,
    currentCorrection,
  } = useStore()

  const { 
    startSession, 
    endSession, 
    transcribeAudio, 
    getAiResponse, 
    textToSpeech, 
    playThinkingFiller,
    analyzeUserSpeech,
    clearCorrection,
  } = useApi()
  
  const [isInitialized, setIsInitialized] = useState(false)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [permissionState, setPermissionState] = useState<'checking' | 'prompt' | 'requesting' | 'granted' | 'denied'>('checking')
  const [isWaitingForUser, setIsWaitingForUser] = useState(false)
  const [isCorrectionExpanded, setIsCorrectionExpanded] = useState(false)
  
  const timerIntervalRef = useRef<number | null>(null)
  const lastTickRef = useRef<number>(0)
  const initRef = useRef(false)
  const isClosingRef = useRef(false) // Prevent multiple close clicks

  // Check existing mic permission on mount
  useEffect(() => {
    const checkPermission = async () => {
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })
          if (result.state === 'granted') {
            setPermissionState('granted')
            setMicPermission('granted')
            return
          } else if (result.state === 'denied') {
            setPermissionState('denied')
            setMicPermission('denied')
            return
          }
        }
        setPermissionState('prompt')
      } catch {
        setPermissionState('prompt')
      }
    }
    checkPermission()
  }, [setMicPermission])

  // Start conversation when permission is granted
  useEffect(() => {
    if (permissionState === 'granted' && !initRef.current) {
      startConversation()
    }
  }, [permissionState])

  // Timer logic - runs only while speaking (pauses when reading correction)
  useEffect(() => {
    if (isSpeaking && !isAiSpeaking && !isCorrectionExpanded) {
      lastTickRef.current = Date.now()
      timerIntervalRef.current = window.setInterval(() => {
        const now = Date.now()
        const delta = now - lastTickRef.current
        lastTickRef.current = now
        incrementSpeakingTime(delta)
      }, 100)
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = null
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
      }
    }
  }, [isSpeaking, isAiSpeaking, isCorrectionExpanded, incrementSpeakingTime])

  // Check for session completion
  useEffect(() => {
    if (speakingTime >= targetTime) {
      handleSessionComplete()
    }
  }, [speakingTime, targetTime])

  // No auto-trigger - we only use the Done button
  const { volume, startRecording, stopRecording, getRecordedBlob } = useVoiceActivity({
    silenceTimeout: 600, // Pause timer after 0.6s of silence for responsive pausing
  })

  // Request microphone permission
  const requestMicPermission = async () => {
    setPermissionState('requesting')
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
      setPermissionState('granted')
      setMicPermission('granted')
    } catch (err) {
      console.error('Mic permission denied:', err)
      setPermissionState('denied')
      setMicPermission('denied')
    }
  }

  // Start the conversation after permission granted
  const startConversation = async () => {
    if (initRef.current) return
    initRef.current = true
    
    resetSpeakingTime()
    setUserTranscript('')
    
    const session = await startSession()
    if (session) {
      setIsInitialized(true)
      
      if (session.greeting) {
        await textToSpeech(session.greeting)
      }
      
      // Start recording and set waiting for user
      startRecording()
      setIsWaitingForUser(true)
    }
  }

  // Handle "Done" button - user manually triggers AI response
  const handleDone = async () => {
    if (isProcessing || isAiSpeaking) return
    
    setIsWaitingForUser(false)
    setIsProcessing(true)
    setUserTranscript('Transcribing...')
    
    // Stop recording to get final audio
    stopRecording()
    
    // Small delay to ensure recording is fully stopped
    await new Promise(r => setTimeout(r, 100))
    
    // Get recorded audio
    const blob = getRecordedBlob()
    
    if (blob && blob.size > 0) {
      try {
        const transcript = await transcribeAudio(blob)
        
        if (transcript && transcript.trim()) {
          setUserTranscript(transcript)
          clearAiMessage()
          clearCorrection() // Clear any previous correction
          
          // Analyze speech for corrections (runs in parallel with AI response)
          analyzeUserSpeech(transcript)
          
          // Play filler NOW - while AI is thinking (30% chance)
          playThinkingFiller()
          
          // Minimal delay to show transcript (reduced from 600ms)
          await new Promise(r => setTimeout(r, 200))
          
          const response = await getAiResponse(transcript)
          
          if (response) {
            setUserTranscript('')
            await textToSpeech(response)
          }
        } else {
          setUserTranscript('(No speech detected)')
          await new Promise(r => setTimeout(r, 1000))
          setUserTranscript('')
        }
      } catch (err) {
        console.error('Conversation error:', err)
        setUserTranscript('')
      }
    } else {
      setUserTranscript('(No audio recorded)')
      await new Promise(r => setTimeout(r, 1000))
      setUserTranscript('')
    }
    
    setIsProcessing(false)
    
    // Restart recording for next turn
    startRecording()
    setIsWaitingForUser(true)
  }

  const handleSessionComplete = async () => {
    stopRecording()
    await endSession(speakingTime)
    setScreen('completion')
  }

  const handleClose = async () => {
    // Prevent multiple clicks
    if (isClosingRef.current) return
    isClosingRef.current = true
    
    try {
      stopRecording()
      if (speakingTime > 0) {
        await endSession(speakingTime)
      }
      resetSession()
      setScreen('home')
    } catch (err) {
      console.error('Error closing session:', err)
      // Still navigate home even if there's an error
      resetSession()
      setScreen('home')
    } finally {
      // Reset after a delay to allow navigation
      setTimeout(() => {
        isClosingRef.current = false
      }, 1000)
    }
  }

  const progress = (speakingTime / targetTime) * 100
  const timeRemaining = Math.max(0, targetTime - speakingTime)
  const minutes = Math.floor(timeRemaining / 60000)
  const seconds = Math.floor((timeRemaining % 60000) / 1000)

  // Loading state while checking permission
  if (permissionState === 'checking') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="h-full flex items-center justify-center"
      >
        <Loader2 className="w-8 h-8 text-primary-400 animate-spin" />
      </motion.div>
    )
  }

  // Show mic permission prompt screen
  if (permissionState === 'prompt' || permissionState === 'requesting') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="h-full flex flex-col items-center justify-center p-6 relative z-10"
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', delay: 0.1 }}
          className="relative mb-8"
        >
          <motion.div
            className="absolute inset-0 rounded-full bg-primary-500/20"
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <motion.div
            className="absolute inset-0 rounded-full bg-primary-500/20"
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
          />
          
          <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center glow-primary">
            <Mic className="w-16 h-16 text-white" />
          </div>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-center mb-8"
        >
          <h2 className="font-display text-3xl font-bold mb-4">
            Enable Your Microphone
          </h2>
          <p className="text-surface-400 text-lg max-w-xs mx-auto">
            We need access to your microphone to hear you speak and help improve your fluency.
          </p>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="w-full max-w-xs space-y-4"
        >
          <button
            onClick={requestMicPermission}
            disabled={permissionState === 'requesting'}
            className="w-full btn-primary rounded-2xl py-4 flex items-center justify-center gap-3 font-semibold text-lg text-white disabled:opacity-50"
          >
            {permissionState === 'requesting' ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Requesting Access...
              </>
            ) : (
              <>
                <Mic className="w-5 h-5" />
                Allow Microphone
              </>
            )}
          </button>

          <button
            onClick={() => {
              resetSession()
              setScreen('home')
            }}
            className="w-full glass rounded-2xl py-3 font-medium text-surface-400 hover:bg-white/10 transition-colors"
          >
            Go Back
          </button>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-surface-500 text-sm mt-8 text-center max-w-xs"
        >
          Your audio is only used during the conversation and is not stored permanently.
        </motion.p>
      </motion.div>
    )
  }

  // Show mic permission denied state
  if (permissionState === 'denied') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="h-full flex flex-col items-center justify-center p-6 relative z-10"
      >
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center mb-6"
        >
          <MicOff className="w-12 h-12 text-red-400" />
        </motion.div>
        
        <h2 className="text-2xl font-semibold mb-3">Microphone Blocked</h2>
        <p className="text-surface-400 text-center mb-6 max-w-xs">
          Microphone access was denied. To use speaking practice, please enable it in your browser settings.
        </p>

        <div className="glass rounded-xl p-4 mb-8 max-w-xs">
          <p className="text-surface-300 text-sm">
            <strong>How to enable:</strong>
          </p>
          <ol className="text-surface-400 text-sm mt-2 space-y-1 list-decimal list-inside">
            <li>Click the lock/info icon in your address bar</li>
            <li>Find "Microphone" in the permissions</li>
            <li>Change it to "Allow"</li>
            <li>Refresh the page</li>
          </ol>
        </div>

        <div className="space-y-3 w-full max-w-xs">
          <button
            onClick={() => setPermissionState('prompt')}
            className="w-full btn-primary rounded-2xl py-4 font-semibold text-white"
          >
            Try Again
          </button>
          
          <button
            onClick={() => {
              resetSession()
              setScreen('home')
            }}
            className="w-full glass rounded-2xl py-3 font-medium text-surface-400 hover:bg-white/10 transition-colors"
          >
            Go Back
          </button>
        </div>
      </motion.div>
    )
  }

  // Main conversation screen (permission granted)
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full flex flex-col items-center relative z-10"
    >
      {/* Header */}
      <div className="w-full flex items-center justify-between p-4 pt-6">
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleClose()
          }}
          disabled={isClosingRef.current}
          className="p-2 rounded-full glass hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="w-6 h-6 text-surface-400" />
        </button>

        {/* Speed control */}
        <div className="relative">
          <button
            onClick={() => setShowSpeedMenu(!showSpeedMenu)}
            className="flex items-center gap-2 glass rounded-full px-3 py-2 hover:bg-white/10 transition-colors"
          >
            <Gauge className="w-4 h-4 text-surface-400" />
            <span className="text-sm font-medium">{audioSpeed}×</span>
          </button>

          <AnimatePresence>
            {showSpeedMenu && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute top-full right-0 mt-2 glass rounded-xl overflow-hidden"
              >
                {SPEED_OPTIONS.map((speed) => (
                  <button
                    key={speed}
                    onClick={() => {
                      setAudioSpeed(speed)
                      setShowSpeedMenu(false)
                    }}
                    className={`w-full px-4 py-2 text-sm font-medium hover:bg-white/10 transition-colors whitespace-nowrap ${
                      speed === audioSpeed ? 'bg-primary-500/20 text-primary-400' : ''
                    }`}
                  >
                    {speed}× {speed === 0.8 ? '(Slow)' : speed === 0.9 ? '(Natural)' : '(Normal)'}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Main speaking area */}
      <div className="flex-1 flex flex-col items-center justify-start w-full px-6 overflow-y-auto pt-4">
        {/* Speaking visualization */}
        <div className="relative mb-8">
          {/* Outer rings - show when waiting for user (listening mode) */}
          {isWaitingForUser && !isAiSpeaking && !isProcessing && (
            <>
              <motion.div
                className="absolute inset-0 rounded-full bg-primary-500/20"
                initial={{ scale: 1, opacity: 0.4 }}
                animate={{ scale: 2, opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <motion.div
                className="absolute inset-0 rounded-full bg-primary-500/20"
                initial={{ scale: 1, opacity: 0.4 }}
                animate={{ scale: 2, opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity, delay: 0.5 }}
              />
            </>
          )}

          {/* Main circle */}
          <motion.div
            animate={{
              scale: isSpeaking && !isProcessing ? 1 + volume * 0.3 : 1,
              boxShadow: isWaitingForUser && !isAiSpeaking && !isProcessing
                ? '0 0 80px rgba(237, 116, 36, 0.5), 0 0 120px rgba(237, 116, 36, 0.3)'
                : isAiSpeaking
                ? '0 0 60px rgba(34, 197, 99, 0.4), 0 0 100px rgba(34, 197, 99, 0.2)'
                : '0 0 40px rgba(237, 116, 36, 0.2)',
            }}
            className={`w-40 h-40 rounded-full flex items-center justify-center transition-colors duration-300 ${
              isWaitingForUser && !isAiSpeaking && !isProcessing
                ? 'bg-gradient-to-br from-primary-400 to-primary-600' 
                : isAiSpeaking
                ? 'bg-gradient-to-br from-accent-400 to-accent-600'
                : isProcessing
                ? 'bg-gradient-to-br from-yellow-500 to-orange-500'
                : 'bg-gradient-to-br from-surface-700 to-surface-800'
            }`}
          >
            {isProcessing ? (
              <Loader2 className="w-12 h-12 text-white animate-spin" />
            ) : (
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <motion.div
                    key={i}
                    className={`w-2 rounded-full ${
                      isWaitingForUser || isAiSpeaking ? 'bg-white' : 'bg-surface-500'
                    }`}
                    animate={{
                      height: (isSpeaking || isAiSpeaking)
                        ? [12, 28 + Math.random() * 20, 12]
                        : isWaitingForUser
                        ? [12, 18, 12]
                        : 12,
                    }}
                    transition={{
                      duration: isSpeaking || isAiSpeaking ? 0.3 : 0.8,
                      repeat: (isWaitingForUser || isAiSpeaking) ? Infinity : 0,
                      delay: i * 0.1,
                    }}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </div>

        {/* Status and transcript display */}
        <div className="text-center mb-6 flex flex-col items-center justify-start pb-4">
          {/* User transcript */}
          {userTranscript && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4"
            >
              <span className="text-surface-500 text-xs uppercase tracking-wider">
                {userTranscript === 'Transcribing...' ? '' : 'You said:'}
              </span>
              <p className={`text-lg mt-1 max-w-xs ${
                userTranscript === 'Transcribing...' ? 'text-yellow-400' : 'text-white'
              }`}>
                {userTranscript === 'Transcribing...' ? userTranscript : `"${userTranscript}"`}
              </p>
            </motion.div>
          )}
          
          {/* Inline Correction */}
          {currentCorrection && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 w-full max-w-sm"
            >
              <CorrectionCard 
                correction={currentCorrection} 
                onDismiss={() => {
                  setIsCorrectionExpanded(false)
                  clearCorrection()
                }}
                onExpandChange={setIsCorrectionExpanded}
              />
            </motion.div>
          )}

          {/* AI speaking */}
          {isAiSpeaking && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center justify-center gap-2 mb-2">
                <Volume2 className="w-5 h-5 text-accent-400" />
                <span className="text-accent-400 font-medium">AI is speaking</span>
              </div>
              <p className="text-surface-300 text-lg max-w-xs">
                {aiMessage || '...'}
              </p>
            </motion.div>
          )}

          {/* Listening indicator - show when waiting for user (regardless of speaking state) */}
          {isWaitingForUser && !isProcessing && !isAiSpeaking && !userTranscript && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <span className="text-primary-400 font-semibold text-xl">
                Listening... 🎙️
              </span>
            </motion.div>
          )}

          {/* Starting */}
          {!isInitialized && (
            <span className="text-surface-400">
              Starting conversation...
            </span>
          )}
        </div>

        {/* Done button - only show when waiting for user and not processing */}
        {isWaitingForUser && !isAiSpeaking && !isProcessing && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={handleDone}
            className="flex items-center gap-2 btn-primary rounded-full px-10 py-4 font-semibold text-lg text-white shadow-lg"
          >
            <Send className="w-5 h-5" />
            Done
          </motion.button>
        )}
      </div>

      {/* Timer at bottom */}
      <div className="w-full p-6 pb-10">
        {/* Progress bar */}
        <div className="w-full h-2 bg-surface-800 rounded-full overflow-hidden mb-4">
          <motion.div
            className="h-full bg-gradient-to-r from-primary-500 to-primary-400 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ ease: 'linear' }}
          />
        </div>

        {/* Time display */}
        <div className="flex items-center justify-between">
          <span className="text-surface-400 text-sm">
            {isSpeaking && !isAiSpeaking ? 'Speaking...' : 'Paused'}
          </span>
          <span className={`font-mono text-2xl font-semibold ${
            isSpeaking && !isAiSpeaking ? 'text-white' : 'text-surface-500'
          }`}>
            {minutes}:{seconds.toString().padStart(2, '0')}
          </span>
          <span className="text-surface-400 text-sm">remaining</span>
        </div>
      </div>

    </motion.div>
  )
}
