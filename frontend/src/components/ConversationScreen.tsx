import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Capacitor } from '@capacitor/core'
import { X, Gauge, MicOff, Mic, Send, Loader2, VolumeX, Languages, History, Volume2, Lightbulb, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { useApi, unlockAudio, type ReplySuggestion } from '../hooks/useApi'
import { useVoiceActivity } from '../hooks/useVoiceActivity'
import { isPraiseworthy, pickPraise, goalPraise, type Praise } from '../encouragement'
import { VAD_PAUSE_MS, GRACE_MS, SUGGESTIONS_AUTO_OPEN_MS, LONG_SILENCE_MS, MIN_TURN_SPEECH_MS, silenceWaitMs } from '../hooks/turnTiming'
import { cancelTodayReminder, hasSeenNotificationPrompt } from '../hooks/useNotifications'
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
    setPendingNotificationPrompt,
    setSessionWrapUp,
  } = useStore()

  const {
    startSession,
    endSession,
    transcribeAudio,
    transcribeAudioChunk,
    getAiResponse,
    textToSpeech,
    translateText,
    analyzeUserSpeech,
    clearCorrection,
    logEvent,
    getSuggestions,
  } = useApi()

  const targetLanguage = useStore((s) => s.targetLanguage)
  
  const [isInitialized, setIsInitialized] = useState(false)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [permissionState, setPermissionState] = useState<'checking' | 'prompt' | 'requesting' | 'granted' | 'denied'>('checking')
  const [isWaitingForUser, setIsWaitingForUser] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [aiTranslationOpen, setAiTranslationOpen] = useState<{ source: string; translation: string } | null>(null)
  const [aiTranslationLoading, setAiTranslationLoading] = useState(false)
  const [autoSubmitPending, setAutoSubmitPending] = useState(false) // true while waiting out a pause before auto-submit
  const [inGrace, setInGrace] = useState(false) // the last second before auto-submit: speaking again cancels it
  const [turnStarted, setTurnStarted] = useState(false) // user has said something in the current turn
  const [showHistory, setShowHistory] = useState(false)
  const [stage, setStage] = useState<'transcribing' | 'thinking' | null>(null) // what the app is doing after a turn is sent
  const [praise, setPraise] = useState<Praise | null>(null) // a cheer after a real attempt in the target language
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [helpDismissed, setHelpDismissed] = useState(false) // user closed the suggestions for this AI message
  // items === null means "still loading"
  const [suggestions, setSuggestions] = useState<{ forText: string; items: ReplySuggestion[] | null } | null>(null)

  const initRef = useRef(false)
  const isClosingRef = useRef(false) // Prevent multiple close clicks
  const chatScrollRef = useRef<HTMLDivElement>(null) // Scroll container for the "Earlier" sheet (avoid scrollIntoView on iOS)
  const chunkBusyRef = useRef(false)
  const lastChunkTsRef = useRef(0)
  const aiTranslationCacheRef = useRef<Map<string, string>>(new Map())
  const hasSpokenThisTurnRef = useRef(false) // Has the user said anything yet in the current "waiting for user" turn?
  const isHandlingDoneRef = useRef(false) // Synchronous re-entrancy guard (manual tap + auto-submit can race)
  const handleDoneRef = useRef<(trigger?: 'auto' | 'manual', silenceWaitMs?: number | null) => void>(() => {}) // Always points at the latest handleDone; set below
  const turnSpeechMsRef = useRef(0) // How long the user has actually spoken in the current turn
  const graceActiveRef = useRef(false) // In the "sending..." grace window right now
  const graceCancelsRef = useRef(0) // How many times speaking again cancelled a send this turn
  const goalCelebratedRef = useRef(false) // Already cheered the daily goal in this session
  // Usage-event bookkeeping (what happened, for how long, and where they got stuck)
  const sessionStartedAtRef = useRef(0)
  const turnIndexRef = useRef(0) // How many turns they've submitted so far
  const turnOpenedAtRef = useRef(0) // When the mic opened for the current turn
  const firstSpeechAtRef = useRef<number | null>(null)
  const lastSpeechEndAtRef = useRef<number | null>(null)
  const longestPauseMsRef = useRef(0)
  const emptyTurnsInARowRef = useRef(0)
  const replayRef = useRef<{ text: string; count: number }>({ text: '', count: 0 })
  const lastStruggleRef = useRef<{ reason: string; at: number } | null>(null)
  const longSilenceTurnRef = useRef(-1)
  const goalLoggedRef = useRef(false)
  // Transcription started during the grace window, before we were sure they'd finished. If they
  // say nothing more it's already under way (or done) when the turn is sent; if they do, it's ignored.
  const speculativeRef = useRef<{ speechMs: number; promise: ReturnType<typeof transcribeAudio> } | null>(null)
  const graceStartedAtRef = useRef<number | null>(null)

  const lastAiText = [...conversationHistory].reverse().find((m) => m.role === 'assistant')?.content ?? ''
  const lastUserText = [...conversationHistory].reverse().find((m) => m.role === 'user')?.content ?? ''
  // What the user sees as "You said": live/partial transcript while it exists,
  // otherwise their last finished turn (so it doesn't vanish when the AI answers).
  const shownTranscript = userTranscript || lastUserText

  // Start of a fresh "waiting for the user" turn. newTurn=false is for re-opening the
  // mic after playing audio (replay, a suggestion): same turn, so its clock keeps running.
  const resetTurnState = useCallback((newTurn = true) => {
    hasSpokenThisTurnRef.current = false
    turnSpeechMsRef.current = 0
    graceCancelsRef.current = 0
    graceActiveRef.current = false
    setTurnStarted(false)
    setInGrace(false)
    if (newTurn) {
      turnOpenedAtRef.current = Date.now()
      firstSpeechAtRef.current = null
      lastSpeechEndAtRef.current = null
      longestPauseMsRef.current = 0
    }
  }, [])

  // A moment the learner may have struggled (couldn't start, wasn't heard, hit a
  // wall). Behaviour only: it says friction happened, not how anyone felt.
  // turns_before = turns submitted before this moment (0 = before the first answer).
  const signalStruggle = useCallback((reason: string, extra?: Record<string, unknown>) => {
    lastStruggleRef.current = { reason, at: Date.now() }
    logEvent('struggle_signal', { reason, turns_before: turnIndexRef.current, ...extra })
  }, [logEvent])
  
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
  const { volume, startRecording, stopRecording, stopRecordingAndGetBlob, getSnapshotBlob } = useVoiceActivity({
    silenceTimeout: 600, // Pause timer after 0.6s of silence for responsive pausing
    chunkIntervalMs: 2000, // 2s chunks for streaming-ish transcription
    // The "speech" turned out to be steady background noise: the user hasn't spoken yet, so
    // forget it (otherwise the app would "send" a recording of nothing but noise) and take back
    // the speaking time it counted.
    onNoiseOnly: () => {
      incrementSpeakingTime(-turnSpeechMsRef.current)
      hasSpokenThisTurnRef.current = false
      turnSpeechMsRef.current = 0
      graceCancelsRef.current = 0
      graceActiveRef.current = false
      firstSpeechAtRef.current = null
      lastSpeechEndAtRef.current = null
      longestPauseMsRef.current = 0
      setTurnStarted(false)
    },
    onAudioData: async (blob) => {
      if (!isWaitingForUser || isProcessing || isAiSpeaking) return
      if (!blob || blob.size < 200) return

      const now = Date.now()
      if (now - lastChunkTsRef.current < 1500) return
      if (chunkBusyRef.current) return

      chunkBusyRef.current = true
      lastChunkTsRef.current = now
      try {
        const partial = await transcribeAudioChunk(blob, targetLanguage)
        if (partial && partial.trim()) {
          setUserTranscript(partial.trim())
        }
      } finally {
        chunkBusyRef.current = false
      }
    },
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
        sessionStartedAtRef.current = Date.now()
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
        resetTurnState()
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
  }, [resetSpeakingTime, setUserTranscript, setIsProcessing, setStartError, startSession, textToSpeech, startRecording, setIsWaitingForUser, resetTurnState])

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
        logEvent('mic_permission_granted')
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
        logEvent('mic_permission_granted')
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
        logEvent('mic_permission_denied')
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
  }, [setMicPermission, logEvent])

  const startSpeculation = () => {
    const speechMs = turnSpeechMsRef.current
    if (speechMs < MIN_TURN_SPEECH_MS) return // a blip of noise: nothing worth sending
    lastChunkTsRef.current = Date.now() // keep the live-chunk transcriber quiet for the chunk this flushes
    const promise = (async () => {
      const snapshot = await getSnapshotBlob()
      if (!snapshot || snapshot.size < 200) return null
      return transcribeAudio(snapshot, targetLanguage, speechMs)
    })()
    speculativeRef.current = { speechMs, promise }
  }
  const startSpeculationRef = useRef(startSpeculation)
  startSpeculationRef.current = startSpeculation

  // Handle "Done" - triggered either by tapping the button or by auto-submit
  // after a pause in speech. Guarded so both paths can't double-fire.
  const handleDone = async (trigger: 'auto' | 'manual' = 'manual', silenceWaitMs: number | null = null) => {
    if (isProcessing || isAiSpeaking || isHandlingDoneRef.current) return
    isHandlingDoneRef.current = true
    setAutoSubmitPending(false)
    setInGrace(false)

    // Hardly any speech was heard (a noise blip, or Done tapped with nothing said): don't send it. The
    // transcriber would invent a sentence out of near-silence ("Ik wens u nog een fijne avond").
    if (turnSpeechMsRef.current < MIN_TURN_SPEECH_MS) {
      logEvent('turn_skipped', { trigger, speech_ms: Math.round(turnSpeechMsRef.current) })
      incrementSpeakingTime(-turnSpeechMsRef.current) // give back time the noise was counted as speech
      speculativeRef.current = null
      graceStartedAtRef.current = null
      setIsWaitingForUser(false)
      await stopRecordingAndGetBlob().catch(() => null) // throw the recording away
      if (trigger === 'manual') {
        // They tapped Done themselves, so tell them; a noise blip that sent itself needs no message.
        setUserTranscript('Didn\'t hear anything. Please try again.')
        await new Promise(r => setTimeout(r, 1800))
        setUserTranscript('')
      }
      resetTurnState()
      startRecording()
      setIsWaitingForUser(true)
      isHandlingDoneRef.current = false
      return
    }

    // Snapshot the shape of this turn now; the event is logged once we know how
    // much they actually said (so we can see if short submissions are cut-offs).
    const turnSpeechMs = Math.round(turnSpeechMsRef.current)
    const graceCancels = graceCancelsRef.current
    const longestPauseMs = Math.round(longestPauseMsRef.current)
    const timeToFirstSpeechMs = firstSpeechAtRef.current !== null
      ? firstSpeechAtRef.current - turnOpenedAtRef.current
      : null
    const turnIndex = turnIndexRef.current + 1 // 1-based
    const startedAt = performance.now() // for response_timing
    const graceStartedAt = graceStartedAtRef.current // when "Got it, sending..." began (null if sent by tapping Done)
    graceStartedAtRef.current = null
    const logTurn = (text: string) => {
      const trimmed = text.trim()
      logEvent('turn_submitted', {
        trigger,
        turn_index: turnIndex,
        speech_ms: turnSpeechMs,
        silence_wait_ms: silenceWaitMs,
        grace_cancels: graceCancels,
        longest_pause_ms: longestPauseMs,
        time_to_first_speech_ms: timeToFirstSpeechMs,
        word_count: trimmed ? trimmed.split(/\s+/).length : 0,
        char_count: trimmed.length,
      })
    }
    // Nothing usable came back (silence, noise, or a failed upload). Two in a row is a struggle.
    const noteEmptyTurn = () => {
      emptyTurnsInARowRef.current += 1
      if (emptyTurnsInARowRef.current >= 2) {
        signalStruggle('no_speech_repeat', { count: emptyTurnsInARowRef.current })
      }
    }

    setIsWaitingForUser(false)
    setIsProcessing(true)
    setStage('transcribing')
    setUserTranscript('Transcribing...')
    setCurrentYouMeant(null)

    let stopPromise: Promise<Blob | null> | null = null
    try {
    // Transcription may already be under way from the grace window. It's only good if they haven't
    // said anything since it started (their speech time hasn't moved).
    const spec = speculativeRef.current
    speculativeRef.current = null
    const speculationValid = !!spec && spec.speechMs === turnSpeechMsRef.current

    // Stop the recorder (Safari/WKWebView needs a moment to flush its final chunk). We only have to
    // wait for that blob when there's no usable head start.
    console.log('[handleDone] Calling stopRecordingAndGetBlob...')
    stopPromise = stopRecordingAndGetBlob()
    let blob: Blob | null = null
    if (!speculationValid) {
      blob = await stopPromise
      console.log('[handleDone] Got blob:', blob?.size, 'bytes, type:', blob?.type)
    }
    
    if (speculationValid || (blob && blob.size > 0)) {
      try {
        // Always use target language as hint to help Whisper interpret imperfect pronunciation
        // During translation repeat step, we still pass targetLanguage to bias toward correct language
        let transcription = speculationValid ? await spec!.promise : await transcribeAudio(blob!, targetLanguage, turnSpeechMs)
        // null = the request failed or timed out (an empty result is not null). Try once more with the
        // final recording before giving up, so a hiccup doesn't cost them their sentence.
        // An empty result from the head-start snapshot is also not trusted: the snapshot may have been cut
        // short, so check the real recording before telling them nobody spoke.
        const emptyHeadStart = speculationValid && transcription !== null && !transcription.text?.trim()
        if (transcription === null || emptyHeadStart) {
          console.warn(emptyHeadStart ? '[handleDone] Head-start came back empty, checking the final recording' : '[handleDone] Transcription failed, retrying once')
          blob = blob ?? await stopPromise
          if (blob && blob.size > 0) {
            const second = await transcribeAudio(blob, targetLanguage, turnSpeechMs)
            if (second !== null) transcription = second
          }
        }
        const transcribeMs = Math.round(performance.now() - startedAt)
        
        if (transcription?.text && transcription.text.trim()) {
          const transcript = transcription.text
          logTurn(transcript)
          emptyTurnsInARowRef.current = 0
          if (graceCancels >= 2 || longestPauseMs >= 2500) {
            signalStruggle('hesitation', { grace_cancels: graceCancels, longest_pause_ms: longestPauseMs })
          }
          setUserTranscript(transcript)
          clearCorrection() // Clear any previous correction
          
          // Analyze speech for corrections only when the user is already speaking the target language.
          // If they're speaking English while learning Dutch (etc), we want translation-assist to take over,
          // and we should not show a "correction" card that looks like a translation.
          const looksEnglish = /\b(i|you|we|they|my|your|dont|don't|didn't|cant|can't|won't|wont|not)\b/i.test(transcript)
          if (targetLanguage !== 'en' && looksEnglish) signalStruggle('switched_to_english')
          if (!(targetLanguage !== 'en' && looksEnglish)) {
            analyzeUserSpeech(transcript)

            // They said something real in the target language: a little encouragement.
            // The first time they reach the daily goal this session gets a bigger one.
            if (isPraiseworthy(transcript, targetLanguage)) {
              const { speakingTime: spokenMs, targetTime: goalMs } = useStore.getState()
              if (spokenMs >= goalMs && !goalCelebratedRef.current) {
                goalCelebratedRef.current = true
                const goalMinutes = Math.round(goalMs / 60000)
                setPraise(goalPraise(targetLanguage, `${goalMinutes} minute${goalMinutes === 1 ? '' : 's'}`))
              } else {
                setPraise(pickPraise(targetLanguage))
              }
            }
          }
          
          setStage('thinking')

          // Clear right before we start streaming the next AI response, so the
          // previous AI question stays visible while the user is speaking.
          clearAiMessage()
          
          // Add user message to history (only if valid)
          if (transcript && transcript.trim() && transcript !== 'Transcribing...') {
            addMessage('user', transcript.trim())
          }
          
          // The server sends the spoken version right behind the text on the same stream. The text goes
          // on screen as soon as it's complete, while the voice is still arriving.
          let finalTextShown = false
          let aiTextReadyMs: number | null = null
          const reply = await getAiResponse(transcript, transcription?.detectedLanguage ?? null, {
            withVoice: true,
            onFinalText: (text) => {
              aiTextReadyMs = Math.round(performance.now() - startedAt)
              if (text.trim()) {
                finalTextShown = true
                addMessage('assistant', text.trim())
                setUserTranscript('')
              }
            },
          })
          
          // Clear translation card AFTER processing response
          // Only clear if user didn't explicitly ask for translation (check if transcript looks like translation request)
          const aiTextMs = aiTextReadyMs ?? Math.round(performance.now() - startedAt)
          const isTranslationRequest = /\b(how\s+do\s+(?:you|i)\s+say|what'?s?\s+.+\s+in|translate)\b/i.test(transcript)
          if (isTranslationRequest) signalStruggle('asked_translation')
          if (!isTranslationRequest) {
            // Small delay to ensure SSE events are processed first, then clear
            setTimeout(() => {
              setCurrentTranslation(null)
            }, 100)
          }
          
          if (reply && reply.text.trim()) {
            if (!finalTextShown) {
              addMessage('assistant', reply.text.trim())
              setUserTranscript('')
            }
            // How long the user waited, from the moment we sent their turn off until the AI's voice began.
            let audioStartMs: number | null = null
            let audioStartFromGraceMs: number | null = null
            await textToSpeech(reply.text, () => {
              audioStartMs = Math.round(performance.now() - startedAt)
              if (graceStartedAt !== null) audioStartFromGraceMs = Date.now() - graceStartedAt
            }, reply.audio ?? undefined)
            logEvent('response_timing', {
              transcribe_ms: transcribeMs,
              ai_text_ms: aiTextMs,
              audio_start_ms: audioStartMs,
              audio_start_from_grace_ms: audioStartFromGraceMs, // "Got it, sending..." -> the AI's voice
              speculative: speculationValid,
              voice_with_reply: !!reply.audio,
            })
          } else {
            // We heard them, but no reply came back (error or timeout): tell them, then let them go again.
            logEvent('turn_failed', { stage: 'respond', ai_text_ms: aiTextMs })
            setUserTranscript('Couldn\'t get a reply. Please try again.')
            await new Promise(r => setTimeout(r, 2500))
            setUserTranscript('')
          }
        } else {
          console.warn('[handleDone] No speech detected in transcription result:', transcription)
          if (transcription === null) {
            // The server never answered (even after a retry): say so, instead of claiming they were silent.
            logEvent('transcribe_failed')
            logEvent('turn_failed', { stage: 'transcribe' })
            logTurn('')
            setUserTranscript('Couldn\'t send that. Please say it again.')
            await new Promise(r => setTimeout(r, 2500))
          } else {
            logTurn('')
            noteEmptyTurn()
            setUserTranscript('(No speech detected)')
            await new Promise(r => setTimeout(r, 1000))
          }
          setUserTranscript('')
        }
      } catch (err) {
        console.error('Conversation error:', err)
        setUserTranscript('')
      }
    } else {
      console.warn('[handleDone] No audio blob or empty blob:', (blob as Blob | null)?.size, 'bytes')
      logTurn('')
      noteEmptyTurn()
      setUserTranscript('(No audio recorded)')
      await new Promise(r => setTimeout(r, 1000))
      setUserTranscript('')
    }
    } finally {
      setIsProcessing(false)
      setStage(null)
      // The recorder was stopped in parallel with the work above; make sure it's finished before reopening it.
      await stopPromise?.catch(() => null)

      // Restart recording for next turn
      turnIndexRef.current = turnIndex
      resetTurnState()
      startRecording()
      setIsWaitingForUser(true)
      isHandlingDoneRef.current = false
    }
  }

  // Keep a stable ref to the latest handleDone, so the auto-submit timer
  // (scheduled from an effect below) always calls the current version.
  handleDoneRef.current = handleDone

  const handleClose = async () => {
    // Prevent multiple clicks
    if (isClosingRef.current) return
    isClosingRef.current = true
    
    try {
      stopRecording()

      // Where were they when they left? Leaving right after a struggle is the
      // closest thing we can observe to "this isn't going to work for me".
      const lastState = isProcessing ? 'processing'
        : isAiSpeaking ? 'ai_speaking'
        : turnStarted ? 'mid_answer'
        : currentCorrection ? 'after_correction'
        : emptyTurnsInARowRef.current > 0 ? 'after_no_speech'
        : suggestionsOpen ? 'suggestions_open'
        : turnIndexRef.current === 0 ? 'before_first_speech'
        : 'waiting_to_speak'
      const struggle = lastStruggleRef.current
      logEvent('conversation_closed', {
        duration_ms: sessionStartedAtRef.current ? Date.now() - sessionStartedAtRef.current : null,
        turns: turnIndexRef.current,
        speaking_ms: Math.round(speakingTime),
        spoke: speakingTime > 0,
        last_state: lastState,
        last_struggle: struggle?.reason ?? null,
        ms_since_struggle: struggle ? Date.now() - struggle.at : null,
      })

      if (speakingTime > 0) {
        // Leave them with a kind word on the home screen.
        setSessionWrapUp({ speakingMs: speakingTime, hitGoal: speakingTime >= targetTime, languageCode: targetLanguage })
        const result = await endSession(speakingTime)
        if (result?.completed) {
          // They just hit today's goal - no need to remind them tonight.
          cancelTodayReminder()
          // First time ever hitting the goal: offer the reminder opt-in, right
          // at the moment they've just felt the product work.
          if (Capacitor.isNativePlatform() && !hasSeenNotificationPrompt()) {
            setPendingNotificationPrompt(true)
          }
        }
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
        turnSpeechMsRef.current += 100
      }
    }, 100) // Update every 100ms for smooth progress
    
    return () => clearInterval(interval)
  }, [isInitialized, isSpeaking, isAiSpeaking, isProcessing, incrementSpeakingTime])

  // Auto-submit the turn after a pause in speech, so users don't have to
  // remember to tap "Done". Tapping Done manually still works and takes
  // priority (handleDone is re-entrancy-guarded against both firing).
  //
  // Two stages (see turnTiming.ts): a silence wait, then a one-second grace
  // window where the pill says "Got it, sending..." but nothing has been sent -
  // speaking again in that second cancels the send and the recording simply
  // carries on, so a learner pausing mid-sentence isn't cut off.
  useEffect(() => {
    if (!isWaitingForUser || isAiSpeaking || isProcessing) {
      graceActiveRef.current = false
      setInGrace(false)
      setAutoSubmitPending(false)
      return
    }

    if (isSpeaking) {
      // User is talking - remember it, and don't count silence yet.
      if (graceActiveRef.current) {
        graceCancelsRef.current += 1
        graceActiveRef.current = false
      }
      speculativeRef.current = null // they're still talking: whatever was started is out of date
      graceStartedAtRef.current = null
      const now = Date.now()
      if (firstSpeechAtRef.current === null) firstSpeechAtRef.current = now
      if (lastSpeechEndAtRef.current !== null) {
        longestPauseMsRef.current = Math.max(longestPauseMsRef.current, now - lastSpeechEndAtRef.current)
        lastSpeechEndAtRef.current = null
      }
      hasSpokenThisTurnRef.current = true
      setTurnStarted(true)
      setInGrace(false)
      setAutoSubmitPending(false)
      return
    }

    if (!hasSpokenThisTurnRef.current) {
      // Silence, but nothing said yet this turn - nothing to auto-submit.
      return
    }

    // Silence after speech. isSpeaking already went false after VAD_PAUSE_MS of
    // silence, so only the remainder is left to wait.
    if (lastSpeechEndAtRef.current === null) lastSpeechEndAtRef.current = Date.now()
    setAutoSubmitPending(true)
    const totalWaitMs = silenceWaitMs(turnSpeechMsRef.current)
    let graceTimerId: number | undefined
    const silenceTimerId = window.setTimeout(() => {
      // Barely any speech (a noise blip): there's nothing to confirm, so skip the "sending..." step;
      // handleDone discards it quietly.
      if (turnSpeechMsRef.current < MIN_TURN_SPEECH_MS) {
        handleDoneRef.current('auto', totalWaitMs)
        return
      }
      graceActiveRef.current = true
      setInGrace(true)
      graceStartedAtRef.current = Date.now()
      startSpeculationRef.current() // get a head start on transcribing; thrown away if they speak again
      graceTimerId = window.setTimeout(() => {
        graceActiveRef.current = false
        handleDoneRef.current('auto', totalWaitMs)
      }, GRACE_MS)
    }, Math.max(0, totalWaitMs - VAD_PAUSE_MS))

    return () => {
      window.clearTimeout(silenceTimerId)
      if (graceTimerId !== undefined) window.clearTimeout(graceTimerId)
    }
  }, [isSpeaking, isWaitingForUser, isAiSpeaking, isProcessing])

  // The cheer has done its job once they start their next answer.
  useEffect(() => {
    if (turnStarted) setPraise(null)
  }, [turnStarted])

  // New AI message -> suggestions start fresh (closed, and not "dismissed").
  useEffect(() => {
    setSuggestionsOpen(false)
    setHelpDismissed(false)
  }, [lastAiText])

  // Usage events for moments worth knowing about. (Deliberately separate from the
  // suggestions timer so opening suggestions doesn't restart this clock.)
  useEffect(() => {
    if (!isWaitingForUser || isAiSpeaking || isProcessing || turnStarted) return
    const id = window.setTimeout(() => {
      if (longSilenceTurnRef.current === turnIndexRef.current) return // once per turn
      longSilenceTurnRef.current = turnIndexRef.current
      signalStruggle('long_silence')
    }, LONG_SILENCE_MS)
    return () => window.clearTimeout(id)
  }, [isWaitingForUser, isAiSpeaking, isProcessing, turnStarted, signalStruggle])

  useEffect(() => {
    if (currentCorrection) logEvent('correction_shown')
  }, [currentCorrection, logEvent])

  useEffect(() => {
    // The app had to guess what they meant (garbled transcript)
    if (currentYouMeant) signalStruggle('garbled')
  }, [currentYouMeant, signalStruggle])

  useEffect(() => {
    if (!isInitialized || goalLoggedRef.current || targetTime <= 0 || speakingTime < targetTime) return
    goalLoggedRef.current = true
    logEvent('goal_reached', { session_ms: Date.now() - sessionStartedAtRef.current })
  }, [speakingTime, targetTime, isInitialized, logEvent])

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

  // Scroll the "Earlier" sheet to the latest message when it opens.
  // IMPORTANT: avoid scrollIntoView() on iOS/WKWebView; it can scroll the page/webview and cause UI clipping.
  useEffect(() => {
    if (!showHistory) return
    requestAnimationFrame(() => {
      const el = chatScrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [showHistory])

  const handleTapAiMessage = useCallback(async (text: string) => {
    const source = (text || '').trim()
    if (!source) return

    // Toggle if tapping the same message again
    if (aiTranslationOpen?.source === source) {
      setAiTranslationOpen(null)
      return
    }

    // Needing the AI's line translated = they couldn't follow it
    logEvent('translate_tapped')
    signalStruggle('translated_ai_line')

    const cached = aiTranslationCacheRef.current.get(source)
    if (cached) {
      setAiTranslationOpen({ source, translation: cached })
      return
    }

    setAiTranslationLoading(true)
    setAiTranslationOpen({ source, translation: '' })

    // Translate AI's target-language message into English (current app UX is English-first).
    const translated = await translateText(source, targetLanguage, 'en')
    const finalText = translated || '(Translation unavailable)'
    aiTranslationCacheRef.current.set(source, finalText)
    setAiTranslationOpen({ source, translation: finalText })
    setAiTranslationLoading(false)
  }, [aiTranslationOpen?.source, translateText, targetLanguage, logEvent, signalStruggle])

  // Play some audio (replay, a suggestion, a correction) with the mic off, then
  // go back to listening. The mic has to be off or it hears the playback as the
  // user talking. Skipped if the user is mid-answer, because restarting the
  // recorder would throw away what they've already said.
  const playWithMicPaused = useCallback(async (play: () => Promise<void>) => {
    const s = useStore.getState()
    if (!isWaitingForUser || s.isProcessing || s.isAiSpeaking) return
    if (hasSpokenThisTurnRef.current || isHandlingDoneRef.current || isClosingRef.current) return

    setIsWaitingForUser(false)
    stopRecording()
    try {
      await play()
    } finally {
      if (!isClosingRef.current) {
        resetTurnState(false)
        startRecording()
        setIsWaitingForUser(true)
      }
    }
  }, [isWaitingForUser, stopRecording, startRecording, resetTurnState])

  const handleReplay = useCallback(() => {
    if (!lastAiText) return
    playWithMicPaused(() => {
      logEvent('ai_replayed')
      // Replaying the same line again and again = they're not catching it
      replayRef.current = replayRef.current.text === lastAiText
        ? { text: lastAiText, count: replayRef.current.count + 1 }
        : { text: lastAiText, count: 1 }
      if (replayRef.current.count >= 2) signalStruggle('replay_repeat', { count: replayRef.current.count })
      return textToSpeech(lastAiText)
    })
  }, [lastAiText, playWithMicPaused, textToSpeech, logEvent, signalStruggle])

  const playCorrectionAudio = useCallback((url: string) => playWithMicPaused(() => new Promise<void>((resolve) => {
    logEvent('correction_heard')
    const audio = new Audio(url)
    audio.onended = () => resolve()
    audio.onerror = () => resolve()
    audio.play().catch(() => resolve())
  })), [playWithMicPaused, logEvent])

  const openSuggestions = useCallback(async (trigger: 'tap' | 'timer') => {
    if (!lastAiText) return
    setHelpDismissed(false)
    setSuggestionsOpen(true)
    logEvent('suggestions_shown', { trigger })
    // Asking for help is a direct "I need a hand" (the timer opening is covered by long_silence)
    if (trigger === 'tap') signalStruggle('asked_for_help')

    if (suggestions?.forText === lastAiText && suggestions.items) return // already fetched for this message
    setSuggestions({ forText: lastAiText, items: null })
    const items = await getSuggestions()
    setSuggestions((prev) => (prev && prev.forText === lastAiText ? { forText: lastAiText, items } : prev))
  }, [lastAiText, suggestions, logEvent, getSuggestions, signalStruggle])

  const closeSuggestions = useCallback(() => {
    setSuggestionsOpen(false)
    setHelpDismissed(true) // don't let the quiet-timer pop them straight back open
  }, [])

  const handleTapSuggestion = useCallback((index: number, text: string) => {
    logEvent('suggestion_tapped', { index })
    playWithMicPaused(() => textToSpeech(text))
  }, [logEvent, playWithMicPaused, textToSpeech])

  // Before the user has said anything this turn, offer reply suggestions on
  // their own after a stretch of quiet. No countdown is shown - it's a quiet
  // nudge, and "Need help?" is always there to open them sooner.
  useEffect(() => {
    if (!isWaitingForUser || isAiSpeaking || isProcessing || turnStarted) return
    if (suggestionsOpen || helpDismissed || !lastAiText) return
    // A correction or translation card already has the user's attention (and the
    // room) - don't stack suggestions under it on their own; the link still works.
    if (currentCorrection || currentTranslation) return
    const id = window.setTimeout(() => openSuggestions('timer'), SUGGESTIONS_AUTO_OPEN_MS)
    return () => window.clearTimeout(id)
  }, [isWaitingForUser, isAiSpeaking, isProcessing, turnStarted, suggestionsOpen, helpDismissed, lastAiText, currentCorrection, currentTranslation, openSuggestions])

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
      <div className="w-full flex items-center justify-between p-4 pt-4 bg-[#1c1917]/80 backdrop-blur-sm z-20">
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
                      // Slowing the AI down = it's too fast to follow
                      if (speed < audioSpeed) signalStruggle('slowed_speed', { from: audioSpeed, to: speed })
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

      {/* Main content area: only what's current - the AI's latest line and what you just said.
          Earlier messages live behind the "Earlier" link. */}
      <div className="flex-1 flex flex-col w-full px-4 min-h-0">
        {conversationHistory.length > 1 && (
          <div className="flex justify-center pb-1">
            <button
              onClick={() => {
                logEvent('history_opened')
                setShowHistory(true)
              }}
              className="inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors py-1 px-2"
              type="button"
            >
              <History className="w-3.5 h-3.5" />
              Earlier · {conversationHistory.length - 1} messages
            </button>
          </div>
        )}

        {/* The AI's latest line */}
        <div className="flex-1 w-full overflow-y-auto px-2 py-2 min-h-0 flex flex-col">
          {lastAiText && (
            <motion.div
              key={lastAiText}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="my-auto space-y-3"
            >
              <p className="text-2xl leading-snug font-medium text-white break-words whitespace-pre-wrap">
                {lastAiText}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReplay}
                  className="inline-flex items-center gap-1.5 text-xs text-surface-300 bg-surface-700 hover:bg-surface-600 transition-colors rounded-full px-3 py-1.5"
                  type="button"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  Replay
                </button>
                <button
                  onClick={() => handleTapAiMessage(lastAiText)}
                  className="inline-flex items-center gap-1.5 text-xs text-surface-300 bg-surface-700 hover:bg-surface-600 transition-colors rounded-full px-3 py-1.5"
                  type="button"
                >
                  <Languages className="w-3.5 h-3.5" />
                  Translate
                </button>
              </div>
            </motion.div>
          )}
        </div>

        {/* Cards section (what you said, translations, corrections, suggestions) */}
        <div className="flex-shrink-0 w-full px-2 pb-2 max-h-[50vh] overflow-y-auto">
          {/* User transcript */}
          {shownTranscript && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-3"
            >
              <span className="text-surface-500 text-xs uppercase tracking-wider">
                {shownTranscript === 'Transcribing...' ? '' : 'You said:'}
              </span>
              <p className={`text-base mt-1 ${
                shownTranscript === 'Transcribing...' ? 'text-yellow-400' : 'text-white'
              }`}>
                {shownTranscript === 'Transcribing...' ? shownTranscript : `"${shownTranscript}"`}
              </p>
            </motion.div>
          )}

          {praise && (
            <motion.div
              key={praise.id}
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="text-center mb-3"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-500/20 text-accent-400 text-sm font-medium px-3 py-1">
                <Sparkles className="w-3.5 h-3.5" />
                {praise.cheer}
              </span>
              <p className="text-xs text-surface-400 mt-1.5">{praise.line}</p>
            </motion.div>
          )}

          {currentTranslation && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-3"
            >
              <TranslationCard translation={currentTranslation} />
            </motion.div>
          )}

          {currentYouMeant && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-3"
            >
              <YouMeantCard text={currentYouMeant} />
            </motion.div>
          )}

          {currentCorrection && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-3"
            >
              <CorrectionCard
                correction={currentCorrection}
                onDismiss={() => {
                  logEvent('correction_dismissed')
                  clearCorrection()
                }}
                onPlay={playCorrectionAudio}
              />
            </motion.div>
          )}

          {/* Reply suggestions: only before the user has started answering. A quiet
              "Need help?" link is always there; the panel opens on tap or after a long pause. */}
          {isWaitingForUser && !isAiSpeaking && !isProcessing && !turnStarted && lastAiText && (
            suggestionsOpen ? (
              <div className="mb-2 space-y-2">
                <div className="flex items-center justify-between gap-3 px-1">
                  <span className="text-xs text-surface-400">Need a start? Tap one to hear it, then say it yourself.</span>
                  <button
                    onClick={closeSuggestions}
                    className="text-xs text-surface-500 hover:text-surface-300 transition-colors flex-shrink-0"
                    type="button"
                  >
                    Hide
                  </button>
                </div>
                {suggestions?.forText === lastAiText && suggestions.items === null ? (
                  <div className="flex items-center gap-2 text-xs text-surface-400 px-1 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Thinking of ideas...
                  </div>
                ) : suggestions?.forText === lastAiText && suggestions.items && suggestions.items.length > 0 ? (
                  suggestions.items.map((s, i) => (
                    <button
                      key={`${i}-${s.text}`}
                      onClick={() => handleTapSuggestion(i, s.text)}
                      className="w-full text-left bg-surface-700 border border-surface-600 rounded-xl px-3 py-2.5 hover:bg-surface-600 transition-colors"
                      type="button"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-sm font-medium text-white">{s.text}</span>
                        <Volume2 className="w-4 h-4 text-surface-400 flex-shrink-0" />
                      </div>
                      {s.english && <span className="text-xs text-surface-400">{s.english}</span>}
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-surface-500 px-1 py-2">No ideas right now. Try saying something short.</p>
                )}
              </div>
            ) : (
              <div className="flex justify-center mb-2">
                <button
                  onClick={() => openSuggestions('tap')}
                  className="inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors py-1 px-2"
                  type="button"
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                  Need help?
                </button>
              </div>
            )
          )}

          {/* Error */}
          {startError && (
            <div className="text-center space-y-3 mb-3">
              <span className="text-red-400 block text-sm">{startError}</span>
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
      </div>

      {/* Tap-to-translate modal */}
      <AnimatePresence>
        {aiTranslationOpen && (
          <motion.div
            key="ai-translation-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-end justify-center p-4"
            onClick={() => setAiTranslationOpen(null)}
          >
            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-md glass rounded-2xl p-4 border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-surface-400">Translation (English)</div>
                <button
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                  onClick={() => setAiTranslationOpen(null)}
                >
                  <X className="w-4 h-4 text-surface-400" />
                </button>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-surface-500 uppercase tracking-wider">AI said</div>
                <div className="text-surface-200 text-sm whitespace-pre-wrap">{aiTranslationOpen.source}</div>
              </div>

              <div className="h-px bg-white/10 my-3" />

              <div className="space-y-1">
                <div className="text-xs text-surface-500 uppercase tracking-wider">Meaning</div>
                <div className="text-white text-base whitespace-pre-wrap">
                  {aiTranslationLoading ? 'Translating…' : aiTranslationOpen.translation}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Earlier messages */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            key="history-sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-end justify-center p-4 bg-black/40"
            onClick={() => setShowHistory(false)}
          >
            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-md glass rounded-2xl p-4 border border-white/10 max-h-[75%] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <div className="text-sm text-surface-400">Earlier in this chat</div>
                <button
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                  onClick={() => setShowHistory(false)}
                >
                  <X className="w-4 h-4 text-surface-400" />
                </button>
              </div>
              <div ref={chatScrollRef} className="space-y-3 overflow-y-auto min-h-0">
                {conversationHistory.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                      msg.role === 'user'
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-700 text-surface-200 border border-surface-600'
                    }`}>
                      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom fixed area: Status + Done button + Timer */}
      <div className="flex-shrink-0 w-full bg-[#1c1917] border-t border-surface-800 px-4 pt-3 pb-8">
        {/* Status indicator + Done button row */}
        <div className="flex items-center justify-center gap-4 mb-4">
          {/* Subtle status indicator */}
          {/* Fixed size (sized for the longest label, "Got it, sending...") so
              switching between Ready / Listening / Processing never resizes it */}
          <motion.div
            className={`flex items-center justify-center gap-2 w-48 h-9 px-3 whitespace-nowrap rounded-full ${
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
            {isAiSpeaking ? (
              <>
                <div className="flex items-center gap-0.5">
                  {[...Array(4)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="w-1 bg-accent-400 rounded-full"
                      animate={{ height: [8, 14, 8] }}
                      transition={{ duration: 0.4, repeat: Infinity, delay: i * 0.1 }}
                    />
                  ))}
                </div>
                <span className="text-accent-400 text-sm font-medium">AI Speaking</span>
              </>
            ) : isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />
                <span className="text-yellow-400 text-sm font-medium">
                  {stage === 'thinking' ? 'Thinking...' : 'Transcribing...'}
                </span>
              </>
            ) : isWaitingForUser ? (
              <>
                <div className="flex items-center gap-0.5">
                  {[...Array(4)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="w-1 bg-primary-400 rounded-full"
                      animate={{ 
                        height: isSpeaking ? [8, 12 + volume * 6, 8] : [6, 10, 6],
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
                  {isSpeaking ? 'Listening...' : inGrace ? 'Got it, sending...' : autoSubmitPending ? 'Listening...' : 'Ready'}
                </span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 text-surface-400" />
                <span className="text-surface-400 text-sm">Ready</span>
              </>
            )}
          </motion.div>

          {/* Done button - only shown when waiting for user. Its slot is always
              reserved at the button's full size, so showing/hiding it doesn't
              re-center the status pill or change the row's height (which used to
              shove the progress bar and timer up and down). */}
          <div className="w-28 h-11 shrink-0 flex items-center justify-center">
            {isWaitingForUser && !isAiSpeaking && !isProcessing && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => handleDone('manual')}
                className="flex items-center justify-center gap-2 w-full h-full btn-primary rounded-full font-semibold text-white shadow-lg"
              >
                <Send className="w-4 h-4" />
                Done
              </motion.button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-surface-800 rounded-full overflow-hidden mb-2">
          <motion.div
            className="h-full bg-gradient-to-r from-primary-500 to-primary-400 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ ease: 'linear' }}
          />
        </div>

        {/* Time display */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-surface-400">
            {isSpeaking && !isAiSpeaking ? 'Speaking...' : 'Paused'}
          </span>
          <span className={`font-mono text-lg font-semibold ${
            isSpeaking && !isAiSpeaking ? 'text-white' : 'text-surface-500'
          }`}>
            {minutes}:{seconds.toString().padStart(2, '0')}
          </span>
          <span className="text-surface-400">remaining</span>
        </div>
      </div>

    </motion.div>
  )
}
