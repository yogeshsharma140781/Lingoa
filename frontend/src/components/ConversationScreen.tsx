import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Capacitor } from '@capacitor/core'
import { X, Volume2, Gauge, MicOff, Mic, Send, Loader2, VolumeX } from 'lucide-react'
import { useStore } from '../store'
import { useApi, unlockAudio } from '../hooks/useApi'
import { useVoiceActivity } from '../hooks/useVoiceActivity'
import { CorrectionCard } from './CorrectionCard'
import { TranslationCard } from './TranslationCard'
import { YouMeantCard } from './YouMeantCard'

// Speed options (UI labels - actual speed is mapped in useApi)
const SPEED_OPTIONS = [0.8, 0.9, 1.0]

export function ConversationScreen() {
  const {
    setScreen,
    speakingTime,
    targetTime,
    resetSpeakingTime,
    incrementSpeakingTime,
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
    currentTranslation,
    setCurrentTranslation,
    currentYouMeant,
    setCurrentYouMeant,
    audioSilentMode,
    setAudioSilentMode,
    conversationHistory,
    addMessage,
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

  const targetLanguage = useStore((s) => s.targetLanguage)
  
  const [isInitialized, setIsInitialized] = useState(false)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [permissionState, setPermissionState] = useState<'checking' | 'prompt' | 'requesting' | 'granted' | 'denied'>('checking')
  const [isWaitingForUser, setIsWaitingForUser] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  
  const initRef = useRef(false)
  const isClosingRef = useRef(false) // Prevent multiple close clicks
  const chatEndRef = useRef<HTMLDivElement>(null) // For auto-scrolling chat
  
  // CorrectionCard manages its own expanded state, we just need a callback
  const handleCorrectionExpandChange = useCallback((_expanded: boolean) => {
    // No-op: CorrectionCard manages its own state
  }, [])

  const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

  const openAppSettings = useCallback(async () => {
    if (!isNativeIos) return
    try {
      // iOS deep link to this app's settings page.
      // Capacitor's App plugin does not expose openUrl in our version; use URL scheme directly.
      window.location.href = 'app-settings:'
    } catch (err) {
      console.error('[Permission] Failed to open app settings:', err)
    }
  }, [isNativeIos])

  // Check existing mic permission on mount
  useEffect(() => {
    const checkPermission = async () => {
      try {
        // On iOS, permissions API might not be available, so we'll try getUserMedia directly
        if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
          // On iOS, we can't check permission status without requesting
          // So we'll leave it as 'prompt' and let the user click Continue
          setPermissionState('prompt')
          return
        }
        
        if (navigator.permissions && navigator.permissions.query) {
          const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })
          if (result.state === 'granted') {
            setPermissionState('granted')
            setMicPermission('granted')
            return
          } else if (result.state === 'denied') {
            // On web, if permission is denied, we can still try to request it again
            // Set to 'prompt' so user can try again (iOS will handle this differently)
            setPermissionState('prompt')
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

  // No auto-trigger - we only use the Done button
  const { volume, startRecording, stopRecording, stopRecordingAndGetBlob } = useVoiceActivity({
    silenceTimeout: 600, // Pause timer after 0.6s of silence for responsive pausing
  })

  // Start the conversation after permission granted - MUST be defined before useEffect that uses it
  const startConversation = useCallback(async () => {
    if (initRef.current) return
    initRef.current = true
    
    resetSpeakingTime()
    setUserTranscript('')
    setIsProcessing(true)
    setStartError(null)
    
    try {
      // Unlock audio in background (non-blocking) - will be ready by the time we need to play
      unlockAudio().catch(err => console.warn('[Conversation] Audio unlock failed, continuing anyway:', err))
      console.log('[Conversation] Starting session...')
      
      const session = await startSession()
      if (session) {
        setIsInitialized(true)
        setIsProcessing(false)
        
        // Ensure audio is unlocked and ready before playing greeting
        await unlockAudio().catch(err => console.warn('[Conversation] Audio unlock warning:', err))
        
        // Small delay to ensure audio context is fully ready (especially on iOS)
        await new Promise(resolve => setTimeout(resolve, 300))
        
        if (session.greeting) {
          // Add greeting to chat history
          addMessage('assistant', session.greeting)
          await textToSpeech(session.greeting)
        }
        
        // Start recording and set waiting for user
        startRecording()
        setIsWaitingForUser(true)
      } else {
        throw new Error('Session start returned no data')
      }
    } catch (error: any) {
      console.error('Failed to start conversation:', error)
      setIsProcessing(false)
      setIsInitialized(false)
      setStartError(error.message || 'Failed to start conversation. Please try again.')
      initRef.current = false // Allow retry
    }
  }, [resetSpeakingTime, setUserTranscript, setIsProcessing, setStartError, startSession, textToSpeech, startRecording, setIsWaitingForUser])

  // Request microphone permission - use useCallback to ensure stable reference
  const requestMicPermission = useCallback(async () => {
    console.log('[Permission] Requesting microphone permission...')
    setPermissionState('requesting')
    
    // Add timeout to prevent hanging
    const timeoutId = setTimeout(() => {
      console.warn('[Permission] Permission request timed out')
      setPermissionState('prompt') // Reset to prompt so user can try again
    }, 10000) // 10 second timeout
    
    try {
      // Check if we're on iOS native
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
        console.log('[Permission] iOS detected, requesting getUserMedia...')
        // On iOS, getUserMedia will trigger the native permission dialog
        // The OS dialog will appear automatically
        const stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          }),
          new Promise<MediaStream>((_, reject) => 
            setTimeout(() => reject(new Error('getUserMedia timeout')), 10000)
          )
        ])
        clearTimeout(timeoutId)
        console.log('[Permission] getUserMedia succeeded, stopping tracks...')
        stream.getTracks().forEach(track => track.stop())
        console.log('[Permission] Permission granted!')
        setPermissionState('granted')
        setMicPermission('granted')
      } else {
        console.log('[Permission] Web/Android detected, requesting getUserMedia...')
        // Web/Android
        const stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({ audio: true }),
          new Promise<MediaStream>((_, reject) => 
            setTimeout(() => reject(new Error('getUserMedia timeout')), 10000)
          )
        ])
        clearTimeout(timeoutId)
        stream.getTracks().forEach(track => track.stop())
        console.log('[Permission] Permission granted!')
        setPermissionState('granted')
        setMicPermission('granted')
      }
    } catch (err: any) {
      clearTimeout(timeoutId)
      console.error('[Permission] Mic permission error:', err)
      console.error('[Permission] Error name:', err.name)
      console.error('[Permission] Error message:', err.message)
      
      // Provide more specific error messages
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        console.log('[Permission] Permission denied by user')
        // On iOS: once denied/revoked, the OS prompt typically will NOT show again.
        // User must re-enable in Settings.
        setPermissionState('denied')
        setMicPermission('denied')
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        console.log('[Permission] No microphone found')
        // No microphone found (common on simulator)
        alert('No microphone found. Please test on a real device or ensure your microphone is connected.')
        setPermissionState('prompt') // Reset to prompt so user can try again
        setMicPermission('denied')
      } else if (err.message === 'getUserMedia timeout') {
        console.log('[Permission] Request timed out')
        // Timeout - reset to prompt so user can try again
        setPermissionState('prompt')
      } else {
        // Other error - log it but reset to prompt so user can try again
        console.error('[Permission] Unexpected microphone error:', err)
        setPermissionState('prompt')
        setMicPermission('denied')
      }
    }
  }, [setMicPermission])

  // Handle "Done" button - user manually triggers AI response
  const handleDone = async () => {
    if (isProcessing || isAiSpeaking) return
    
    setIsWaitingForUser(false)
    setIsProcessing(true)
    setUserTranscript('Transcribing...')
    setCurrentYouMeant(null)
    
    // Stop recording and wait for MediaRecorder to flush final chunk (Safari/WKWebView needs this)
    console.log('[handleDone] Calling stopRecordingAndGetBlob...')
    const blob = await stopRecordingAndGetBlob()
    console.log('[handleDone] Got blob:', blob?.size, 'bytes, type:', blob?.type)
    
    if (blob && blob.size > 0) {
      try {
        // Always use target language as hint to help Whisper interpret imperfect pronunciation
        // During translation repeat step, we still pass targetLanguage to bias toward correct language
        const transcription = await transcribeAudio(blob, targetLanguage)
        
        if (transcription?.text && transcription.text.trim()) {
          const transcript = transcription.text
          setUserTranscript(transcript)
          clearCorrection() // Clear any previous correction
          
          // Analyze speech for corrections only when the user is already speaking the target language.
          // If they're speaking English while learning Dutch (etc), we want translation-assist to take over,
          // and we should not show a "correction" card that looks like a translation.
          const looksEnglish = /\b(i|you|we|they|my|your|dont|don't|didn't|cant|can't|won't|wont|not)\b/i.test(transcript)
          if (!(targetLanguage !== 'en' && looksEnglish)) {
            analyzeUserSpeech(transcript)
          }
          
          // Play filler NOW - while AI is thinking (30% chance)
          playThinkingFiller()
          
          // Minimal delay to show transcript (reduced from 600ms)
          await new Promise(r => setTimeout(r, 200))

          // Clear right before we start streaming the next AI response, so the
          // previous AI question stays visible while the user is speaking.
          clearAiMessage()
          
          // Add user message to history (only if valid)
          if (transcript && transcript.trim() && transcript !== 'Transcribing...') {
            addMessage('user', transcript.trim())
          }
          
          const response = await getAiResponse(transcript, transcription?.detectedLanguage ?? null)
          
          // Clear translation card AFTER processing response
          // Only clear if user didn't explicitly ask for translation (check if transcript looks like translation request)
          const isTranslationRequest = /\b(how\s+do\s+(?:you|i)\s+say|what'?s?\s+.+\s+in|translate)\b/i.test(transcript)
          if (!isTranslationRequest) {
            // Small delay to ensure SSE events are processed first, then clear
            setTimeout(() => {
              setCurrentTranslation(null)
            }, 100)
          }
          
          if (response && response.trim()) {
            // Add AI response to history
            addMessage('assistant', response.trim())
            setUserTranscript('')
            await textToSpeech(response)
          }
        } else {
          console.warn('[handleDone] No speech detected in transcription result:', transcription)
          setUserTranscript('(No speech detected)')
          await new Promise(r => setTimeout(r, 1000))
          setUserTranscript('')
        }
      } catch (err) {
        console.error('Conversation error:', err)
        setUserTranscript('')
      }
    } else {
      console.warn('[handleDone] No audio blob or empty blob:', blob?.size, 'bytes')
      setUserTranscript('(No audio recorded)')
      await new Promise(r => setTimeout(r, 1000))
      setUserTranscript('')
    }
    
    setIsProcessing(false)
    
    // Restart recording for next turn
    startRecording()
    setIsWaitingForUser(true)
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

  // ALL useEffect hooks MUST be called before any early returns to comply with React rules of hooks
  // Timer: increment speaking time when user is speaking
  useEffect(() => {
    if (!isInitialized) return
    
    const interval = setInterval(() => {
      // Only increment when user is speaking (not AI, not processing)
      if (isSpeaking && !isAiSpeaking && !isProcessing) {
        incrementSpeakingTime(100) // Increment by 100ms every 100ms
      }
    }, 100) // Update every 100ms for smooth progress
    
    return () => clearInterval(interval)
  }, [isInitialized, isSpeaking, isAiSpeaking, isProcessing, incrementSpeakingTime])

  // Start conversation when permission is granted
  useEffect(() => {
    if (permissionState === 'granted' && !isInitialized && !startError) {
      // Defer the call to ensure it runs after render
      const timer = setTimeout(() => {
        startConversation().catch(err => {
          console.error('[Conversation] Error starting conversation:', err)
          setStartError(err.message || 'Failed to start conversation')
        })
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [permissionState, isInitialized, startError, startConversation])

  // Auto-scroll chat to bottom when messages change
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [conversationHistory])

  // REMOVED: Auto-request feature to prevent infinite loops
  // Users must manually click "Enable Microphone" button to request permission
  // This is simpler and more reliable than trying to detect state transitions

  // Ensure we always have a valid permission state
  const safePermissionState = permissionState || 'checking'
  
  // Calculate progress safely - must be after all hooks but before early returns
  let progress = 0
  let timeRemaining = 0
  let minutes = 0
  let seconds = 0
  
  try {
    progress = (speakingTime / targetTime) * 100
    timeRemaining = Math.max(0, targetTime - speakingTime)
    minutes = Math.floor(timeRemaining / 60000)
    seconds = Math.floor((timeRemaining % 60000) / 1000)
  } catch (err) {
    console.error('[ConversationScreen] Error calculating progress:', err)
  }

  // Loading state while checking permission
  if (safePermissionState === 'checking') {
    return (
      <div className="h-full flex items-center justify-center bg-[#1c1917]">
        <Loader2 className="w-8 h-8 text-primary-400 animate-spin" />
      </div>
    )
  }

  // Show mic permission prompt screen (including requesting state)
  if (safePermissionState === 'prompt' || safePermissionState === 'requesting') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 relative z-10 bg-[#1c1917]">
        <div className="relative mb-8">
          <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center glow-primary">
            <Mic className="w-16 h-16 text-white" />
          </div>
        </div>

        <div className="text-center mb-8">
          <h2 className="font-display text-3xl font-bold mb-4">
            Microphone Access Required
          </h2>
          <p className="text-surface-400 text-lg max-w-xs mx-auto">
            Lingoa needs microphone access to record your voice for language practice conversations. Your audio is only used during the conversation and is not stored permanently.
          </p>
        </div>

        <div className="w-full max-w-xs space-y-4">
          <button
            onClick={() => {
              try {
                requestMicPermission()
              } catch (err) {
                console.error('[Permission] Error in button click:', err)
                setPermissionState('prompt') // Reset to prompt on error
              }
            }}
            disabled={safePermissionState === 'requesting'}
            className="w-full btn-primary rounded-2xl py-4 flex items-center justify-center gap-3 font-semibold text-lg text-white disabled:opacity-50"
          >
            {safePermissionState === 'requesting' ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Requesting Access...
              </>
            ) : (
              <>
                <Mic className="w-5 h-5" />
                Continue
              </>
            )}
          </button>
        </div>

      </div>
    )
  }

  // Show mic permission denied state
  if (safePermissionState === 'denied') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 relative z-10 bg-[#1c1917]">
        <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center mb-6">
          <MicOff className="w-12 h-12 text-red-400" />
        </div>
        
        <h2 className="text-2xl font-semibold mb-3">Microphone Access Required</h2>
        <p className="text-surface-400 text-center mb-8 max-w-xs">
          {isNativeIos
            ? 'Microphone access is turned off for Lingoa. Enable it in iPhone Settings to continue.'
            : 'Please allow microphone access to use speaking practice.'}
        </p>

        <div className="space-y-3 w-full max-w-xs">
          <button
            onClick={() => {
              if (isNativeIos) {
                openAppSettings()
              } else {
                requestMicPermission()
              }
            }}
            className="w-full btn-primary rounded-2xl py-4 font-semibold text-white flex items-center justify-center gap-2"
          >
            <Mic className="w-5 h-5" />
            {isNativeIos ? 'Open Settings' : 'Enable Microphone'}
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
      </div>
    )
  }

  // Main conversation screen (permission granted or conversation started)
  // This should always render - if permission is granted but conversation hasn't started yet,
  // show loading state or error state
  if (permissionState === 'granted' && !isInitialized) {
    // Show error if there's a start error
    if (startError) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-6 bg-[#1c1917]">
          <div className="text-center max-w-xs">
            <h2 className="text-2xl font-semibold mb-3 text-red-400">Error</h2>
            <p className="text-surface-400 mb-6">{startError}</p>
            <div className="space-y-3">
              <button
                onClick={() => {
                  setStartError(null)
                  setIsProcessing(false)
                  initRef.current = false
                  startConversation()
                }}
                className="w-full btn-primary rounded-2xl py-3 font-semibold text-white"
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
          </div>
        </div>
      )
    }
    
    // Show loading state while starting - use simple div to avoid animation issues
    return (
      <div className="h-full flex items-center justify-center bg-[#1c1917]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-400 animate-spin mx-auto mb-4" />
          <p className="text-surface-400">Starting conversation...</p>
        </div>
      </div>
    )
  }
  
  // Only render main conversation if initialized
  if (!isInitialized) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1c1917]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-400 animate-spin mx-auto mb-4" />
          <p className="text-surface-400">Initializing...</p>
        </div>
      </div>
    )
  }
  
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

      {/* Silent Mode Warning */}
      <AnimatePresence>
        {audioSilentMode && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full px-4 pt-2"
          >
            <div className="bg-yellow-900/40 border border-yellow-500/30 rounded-lg p-3 flex items-start gap-3">
              <VolumeX className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-yellow-200 text-sm font-medium mb-1">
                  Phone is in Silent Mode
                </p>
                <p className="text-yellow-300/80 text-xs leading-relaxed">
                  Turn off silent mode to hear the AI speak. Flip the silent switch on the side of your phone.
                </p>
              </div>
              <button
                onClick={() => setAudioSilentMode(false)}
                className="text-yellow-400/60 hover:text-yellow-400 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main speaking area */}
      <div className="flex-1 flex flex-col items-center justify-start w-full px-6 overflow-y-auto pt-4">
        {/* Chat History - Scrollable */}
        {conversationHistory.length > 0 && (
          <div className="w-full mb-4 max-h-72 overflow-y-auto px-2">
            <div className="space-y-3">
              {conversationHistory.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                      msg.role === 'user'
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-700 text-surface-200 border border-surface-600'
                    }`}
                  >
                    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </motion.div>
              ))}
              {/* Auto-scroll anchor */}
              <div ref={chatEndRef} />
            </div>
          </div>
        )}
        {/* Subtle status indicator */}
        <motion.div 
          className={`flex items-center gap-2 px-4 py-2 rounded-full mb-4 ${
            isWaitingForUser && !isAiSpeaking && !isProcessing
              ? 'bg-primary-500/20 border border-primary-500/30'
              : isAiSpeaking
              ? 'bg-accent-500/20 border border-accent-500/30'
              : isProcessing
              ? 'bg-yellow-500/20 border border-yellow-500/30'
              : 'bg-surface-700/50 border border-surface-600'
          }`}
          animate={{
            scale: isSpeaking && !isProcessing ? 1 + volume * 0.05 : 1,
          }}
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
              <span className="text-yellow-400 text-sm font-medium">Processing...</span>
            </>
          ) : isAiSpeaking ? (
            <>
              <div className="flex items-center gap-0.5">
                {[...Array(4)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-accent-400 rounded-full"
                    animate={{ height: [8, 16, 8] }}
                    transition={{ duration: 0.4, repeat: Infinity, delay: i * 0.1 }}
                  />
                ))}
              </div>
              <span className="text-accent-400 text-sm font-medium">AI Speaking</span>
            </>
          ) : isWaitingForUser ? (
            <>
              <div className="flex items-center gap-0.5">
                {[...Array(4)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-primary-400 rounded-full"
                    animate={{ 
                      height: isSpeaking ? [8, 14 + volume * 8, 8] : [6, 10, 6],
                    }}
                    transition={{ 
                      duration: isSpeaking ? 0.2 : 0.6, 
                      repeat: Infinity, 
                      delay: i * 0.08 
                    }}
                  />
                ))}
              </div>
              <span className="text-primary-400 text-sm font-medium">
                {isSpeaking ? 'Listening...' : 'Ready'}
              </span>
            </>
          ) : (
            <>
              <Mic className="w-4 h-4 text-surface-400" />
              <span className="text-surface-400 text-sm">Microphone ready</span>
            </>
          )}
        </motion.div>

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
          {currentTranslation && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 w-full max-w-sm"
            >
              <TranslationCard translation={currentTranslation} />
            </motion.div>
          )}

          {currentYouMeant && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 w-full max-w-sm"
            >
              <YouMeantCard text={currentYouMeant} />
            </motion.div>
          )}

          {currentCorrection && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 w-full max-w-sm"
            >
              <CorrectionCard 
                correction={currentCorrection} 
                onDismiss={() => {
                  clearCorrection()
                }}
                onExpandChange={handleCorrectionExpandChange}
              />
            </motion.div>
          )}

          {/* Last AI text (keep visible even during user's turn) */}
          {aiMessage && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center justify-center gap-2 mb-2">
                <Volume2 className={`w-5 h-5 ${isAiSpeaking ? 'text-accent-400' : 'text-surface-400'}`} />
                <span className={`${isAiSpeaking ? 'text-accent-400' : 'text-surface-400'} font-medium`}>
                  {isAiSpeaking ? 'AI is speaking' : 'AI asked'}
                </span>
              </div>
              <p className="text-surface-300 text-lg max-w-xs">
                {aiMessage}
              </p>
            </motion.div>
          )}


          {/* Starting */}
          {!isInitialized && !startError && (
            <span className="text-surface-400">
              Starting conversation...
            </span>
          )}
          
          {/* Error */}
          {startError && (
            <div className="text-center space-y-3">
              <span className="text-red-400 block">
                {startError}
              </span>
              <button
                onClick={() => {
                  setStartError(null)
                  startConversation()
                }}
                className="btn-primary rounded-xl px-6 py-2 text-sm font-medium"
              >
                Try Again
              </button>
            </div>
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
