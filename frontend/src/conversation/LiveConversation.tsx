// The live conversation screen: connects the redesigned view, the state machine and the
// patient turn-taker to the app's real services (session, speech-to-text, replies, voices).
//
// What decides what:
//  - stateMachine.ts   which screen state follows which event
//  - turnTaking.ts     when the learner has really finished (fed by the voice detector)
//  - this file         the side effects: open/close the mic, transcribe, judge, fetch the next
//                      reply while the feedback is on screen, play audio, save the session.
//
// Order of a turn:  mic open -> learner speaks -> turn ends -> transcribe -> judge ->
// feedback on screen (next AI reply is fetched in the background) -> Continue -> AI speaks.

import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { API_BASE, stopAllAudio, unlockAudio, useApi, type WrapKind } from '../hooks/useApi'
import { cancelTodayReminder, hasSeenNotificationPrompt } from '../hooks/useNotifications'
import { useVoiceActivity } from '../hooks/useVoiceActivity'
import { TOPICS, useStore } from '../store'
import { DEFAULT_TURN_CONFIG, PERSONA_NAMES, REACTION_FALLBACKS, SKIP_UTTERANCES, STALL_PHRASES } from './config'
import { MicGate } from './MicGate'
import { autoContinues, describeState, initialState, transition, type ConversationEvent, type ConversationState } from './stateMachine'
import { playCue } from './cues'
import { TurnTaker, type TurnAction, type TurnSnapshot } from './turnTaking'
import type { AiLine, Evaluation, Hints } from './types'
import { ConversationView, type PlayTarget } from './ui/ConversationView'
import { DebugOverlay } from './ui/DebugOverlay'
import { SettingsSheet } from './ui/SettingsSheet'
import { TranscriptSheet } from './ui/TranscriptSheet'
import { useMicPermission } from './useMicPermission'

const nowSec = () => performance.now() / 1000
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** After this much silence following speech, transcribe what was said so far (to judge whether the sentence is finished). */
const MIC_SETTLE_MS = 150 // after the microphone is released, before a sound is played
const SNAPSHOT_AFTER_SILENCE = 0.7
/** Fewer milliseconds of speech than this is not worth sending to the transcriber. */
const MIN_SPEECH_MS = DEFAULT_TURN_CONFIG.minSpeechDuration * 1000
/**
 * Speech at least this long is a real attempt: if nothing usable comes back, tell the learner. (The speech timer
 * includes a ~0.6 s tail after each burst, so 2200 is about 1.6 s of actual speaking.)
 */
const REAL_SPEECH_MS = 2200

type Transcription = { text: string; detectedLanguage?: string | null } | null
type Reply = { text: string; audio: string | null; serverMs?: Record<string, number> | null; wrap?: WrapKind | null } | null
/** A reply being fetched, with the timings kept for the [Timing] log (see playNextReply). */
type PendingReply = {
  promise: Promise<Reply>
  startedAt: number
  transcribeMs: number
  evaluateMs?: number
  endWaitMs?: number
  speechEndedAt?: number
  readyAt?: number | null
}

export function LiveConversation() {
  const language = useStore((s) => s.targetLanguage)
  const sessionId = useStore((s) => s.sessionId)
  const isSpeaking = useStore((s) => s.isSpeaking)
  const isAiSpeaking = useStore((s) => s.isAiSpeaking)
  const conversationHistory = useStore((s) => s.conversationHistory)

  const api = useApi()
  const apiRef = useRef(api)
  apiRef.current = api

  const permission = useMicPermission()

  // ---- state machine ----
  const [state, dispatch] = useReducer(transition, initialState)
  const stateRef = useRef<ConversationState>(initialState)
  /** Send an event: keeps a synchronous copy of the state for the callbacks that run between renders. */
  const send = useCallback((event: ConversationEvent) => {
    stateRef.current = transition(stateRef.current, event)
    dispatch(event)
  }, [])

  // ---- what is on screen ----
  const [started, setStarted] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [aiLine, setAiLine] = useState<AiLine>({ text: '', translation: '' })
  const [showTranslation, setShowTranslation] = useState(false)
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [hints, setHints] = useState<Hints | null>(null)
  // The learner opened the hint for this AI line: it stays up until the line changes, whatever the mic hears.
  const [hintPinned, setHintPinned] = useState(false)
  const [playing, setPlaying] = useState<PlayTarget | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [scenarioTitle, setScenarioTitle] = useState('Conversation')
  const [debugSnap, setDebugSnap] = useState<TurnSnapshot | null>(null)
  const [micLevel, setMicLevel] = useState(0)
  // Touching a control on the feedback screen stops its "move on by itself" timer.
  const [autoPaused, setAutoPaused] = useState(false)
  // Why the "keep going / new topic / finish" card is up (null when it is not).
  const [wrapKind, setWrapKind] = useState<WrapKind | null>(null)
  // A role-play is one scene: there is no other topic to switch to.
  const isRoleplay = useStore((s) => !!(s.customScenario || s.selectedRoleplayId))

  // ---- turn bookkeeping (refs: read by timers and callbacks) ----
  const taker = useMemo(() => new TurnTaker(DEFAULT_TURN_CONFIG, language), [language])
  const takerRef = useRef(taker)
  takerRef.current = taker
  const micOnRef = useRef(false)
  const initRef = useRef(false)
  const closingRef = useRef(false)
  const turnSpeechMsRef = useRef(0)
  const lastVoicedAtRef = useRef<number | null>(null)
  const snapshotLaunchedRef = useRef(false)
  const specRef = useRef<{ speechMs: number; promise: Promise<Transcription> } | null>(null)
  const micOpenedAtRef = useRef(0)
  // The next time the mic opens is the learner's turn after the AI spoke (or a retry): play the "your turn" sound first.
  const cueNextOpenRef = useRef(false)
  const pendingStopRef = useRef<Promise<unknown> | null>(null) // the last turn's recorder, still finishing
  const firstSpeechAtRef = useRef<number | null>(null)
  const longestPauseRef = useRef(0)
  const turnIndexRef = useRef(0)
  const emptyTurnsRef = useRef(0)
  const sessionStartedAtRef = useRef(0)
  const goalLoggedRef = useRef(false)
  const replyRef = useRef<PendingReply | null>(null)
  const lastTranscriptRef = useRef('')
  const lastAiTextRef = useRef('')
  lastAiTextRef.current = aiLine.text
  const translationCacheRef = useRef<Map<string, string>>(new Map())

  // ---- the voice detector ----
  const { volume, startRecording, releaseMic, stopRecordingAndGetBlob, getSnapshotBlob } = useVoiceActivity({
    silenceTimeout: 600,
    onFrame: ({ voiced }) => {
      if (!micOnRef.current) return
      const t = nowSec()
      takerRef.current.voice(t, voiced)
      if (voiced) {
        if (lastVoicedAtRef.current !== null && stateRef.current.name === 'userSpeaking') {
          longestPauseRef.current = Math.max(longestPauseRef.current, t - lastVoicedAtRef.current)
        }
        lastVoicedAtRef.current = t
        // They are (still) talking: whatever was transcribed ahead of time is out of date.
        snapshotLaunchedRef.current = false
        specRef.current = null
      }
    },
    // What sounded like speech was steady background noise: forget it.
    onNoiseOnly: () => {
      if (!micOnRef.current) return
      useStore.getState().incrementSpeakingTime(-turnSpeechMsRef.current)
      turnSpeechMsRef.current = 0
      takerRef.current.cancelSpeech()
      lastVoicedAtRef.current = null
      snapshotLaunchedRef.current = false
      specRef.current = null
      firstSpeechAtRef.current = null
      if (stateRef.current.name === 'userSpeaking') send({ type: 'SPEECH_CANCELLED' })
    },
  })
  useEffect(() => setMicLevel(Math.min(1, volume * 3)), [volume])

  // ---- microphone on / off ----
  const openMic = useCallback(() => {
    if (micOnRef.current) return
    micOnRef.current = true
    turnSpeechMsRef.current = 0
    lastVoicedAtRef.current = null
    snapshotLaunchedRef.current = false
    specRef.current = null
    firstSpeechAtRef.current = null
    longestPauseRef.current = 0
    micOpenedAtRef.current = Date.now()
    takerRef.current.open(nowSec())
    // If the last turn's recorder is still shutting down, let it finish before reopening the mic.
    const stopping = pendingStopRef.current
    pendingStopRef.current = null
    const cue = cueNextOpenRef.current
    cueNextOpenRef.current = false
    void (async () => {
      await stopping?.catch(() => null)
      // The sound plays BEFORE the microphone opens, so the detector never hears it.
      if (cue && micOnRef.current) await playCue('yourTurn')
      if (micOnRef.current) await startRecording()
    })()
  }, [startRecording])

  const closeMic = useCallback(() => {
    if (!micOnRef.current) return
    micOnRef.current = false
    takerRef.current.close()
    releaseMic() // fully off, not just paused: see releaseMic
  }, [releaseMic])

  // The mic follows the screen state: open while listening/speaking/waiting/hint, closed otherwise.
  // (The turn that just ended stops its own recording: see submitTurn.)
  useEffect(() => {
    if (!started) return
    if (describeState(state).micOpen) openMic()
    else closeMic()
  }, [state, started, openMic, closeMic])

  // ---- speaking time (the daily goal) ----
  useEffect(() => {
    if (!started) return
    const id = window.setInterval(() => {
      const s = useStore.getState()
      if (s.isSpeaking && !s.isAiSpeaking) {
        s.incrementSpeakingTime(100)
        turnSpeechMsRef.current += 100
      }
    }, 100)
    return () => clearInterval(id)
  }, [started, isSpeaking, isAiSpeaking])

  const speakingTime = useStore((s) => s.speakingTime)
  const targetTime = useStore((s) => s.targetTime)
  useEffect(() => {
    if (!started || goalLoggedRef.current || targetTime <= 0 || speakingTime < targetTime) return
    goalLoggedRef.current = true
    apiRef.current.logEvent('goal_reached', { session_ms: Date.now() - sessionStartedAtRef.current, ui: 'v2' })
  }, [speakingTime, targetTime, started])

  // ---- the turn-taker's clock ----
  const launchSnapshot = useCallback(() => {
    const speechMs = turnSpeechMsRef.current
    snapshotLaunchedRef.current = true
    const promise: Promise<Transcription> = (async () => {
      const blob = await getSnapshotBlob()
      if (!blob || blob.size < 200) return null
      return apiRef.current.transcribeAudio(blob, language, speechMs)
    })()
    const spec = { speechMs, promise }
    specRef.current = spec
    // The text so far tells the turn-taker whether the sentence sounds finished.
    promise.then((t) => {
      if (specRef.current === spec && t?.text?.trim()) takerRef.current.setPartialTranscript(t.text.trim())
    })
  }, [getSnapshotBlob, language])

  const handleTakerAction = useCallback((action: TurnAction) => {
    switch (action.type) {
      case 'SPEECH_STARTED':
        if (firstSpeechAtRef.current === null) firstSpeechAtRef.current = Date.now()
        send({ type: 'SPEECH_STARTED' })
        break
      case 'WAITING_TIMEOUT':
        send({ type: 'WAITING_TIMEOUT' })
        break
      case 'RESTING_TIMEOUT':
        // Resting follows "waiting"; if the clock jumped straight past it, go through it.
        if (stateRef.current.name === 'userListening') send({ type: 'WAITING_TIMEOUT' })
        send({ type: 'RESTING_TIMEOUT' })
        break
      case 'TURN_ENDED':
        if (stateRef.current.name === 'userSpeaking') {
          micOnRef.current = false // submitTurn stops the recorder itself, to keep the audio
          takerRef.current.close()
          send({ type: 'TURN_ENDED' })
          void submitTurnRef.current?.(action.reason)
        }
        break
    }
  }, [send])

  // The speaker button: the turn-taking sounds on or off (remembered). Turning them on plays one, as a preview.
  const cuesEnabled = useStore((st) => st.cuesEnabled)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const onToggleSound = useCallback(() => {
    const next = !useStore.getState().cuesEnabled
    useStore.getState().setCuesEnabled(next)
    if (next) void playCue('yourTurn')
  }, [])

  // "Done": the learner ends their turn themselves instead of waiting for the silence. Same path as the
  // silence ending. Ignored unless they are speaking, and for a blip too short to be words.
  const onDone = useCallback(() => {
    if (stateRef.current.name !== 'userSpeaking') return
    if (turnSpeechMsRef.current < MIN_SPEECH_MS) return
    micOnRef.current = false // submitTurn stops the recorder itself, to keep the audio
    takerRef.current.close()
    send({ type: 'TURN_ENDED' })
    void submitTurnRef.current?.('manual')
  }, [send])
  const submitTurnRef = useRef<((reason: 'silence' | 'maxDuration' | 'manual') => Promise<void>) | null>(null)

  useEffect(() => {
    if (!started) return
    const id = window.setInterval(() => {
      const t = nowSec()
      for (const action of takerRef.current.tick(t)) handleTakerActionRef.current(action)
      if (
        stateRef.current.name === 'userSpeaking' &&
        !snapshotLaunchedRef.current &&
        lastVoicedAtRef.current !== null &&
        t - lastVoicedAtRef.current >= SNAPSHOT_AFTER_SILENCE &&
        turnSpeechMsRef.current >= MIN_SPEECH_MS
      ) {
        launchSnapshot()
      }
      if (import.meta.env.DEV) setDebugSnap(takerRef.current.snapshot(t))
    }, 100)
    return () => clearInterval(id)
  }, [started, launchSnapshot])
  const handleTakerActionRef = useRef(handleTakerAction)
  handleTakerActionRef.current = handleTakerAction

  // ---- a finished turn: transcribe, judge, and get the next reply going ----
  const submitTurn = useCallback(async (reason: 'silence' | 'maxDuration' | 'manual') => {
    const startedAt = performance.now()
    // When the learner actually stopped (the last moment of voice), so the whole wait can be timed from there.
    const lastVoiced = lastVoicedAtRef.current
    const speechEndedAt = startedAt - (lastVoiced !== null ? Math.max(0, (nowSec() - lastVoiced) * 1000) : 0)
    const speechMs = Math.round(turnSpeechMsRef.current)
    const turnIndex = turnIndexRef.current + 1
    const timeToFirstSpeechMs = firstSpeechAtRef.current !== null ? firstSpeechAtRef.current - micOpenedAtRef.current : null
    const longestPauseMs = Math.round(longestPauseRef.current * 1000)
    const silenceWaitMs = Math.round(takerRef.current.endThreshold() * 1000)
    const logTurn = (text: string) => {
      const trimmed = text.trim()
      apiRef.current.logEvent('turn_submitted', {
        trigger: reason === 'silence' ? 'auto' : reason === 'manual' ? 'done_button' : 'max_duration',
        turn_index: turnIndex,
        speech_ms: speechMs,
        silence_wait_ms: silenceWaitMs,
        grace_cancels: 0,
        longest_pause_ms: longestPauseMs,
        time_to_first_speech_ms: timeToFirstSpeechMs,
        word_count: trimmed ? trimmed.split(/\s+/).length : 0,
        char_count: trimmed.length,
        ui: 'v2',
      })
    }

    // Use the head start if nothing more was said since it began.
    const spec = specRef.current
    specRef.current = null
    const specValid = !!spec && spec.speechMs === turnSpeechMsRef.current
    const blobPromise = stopRecordingAndGetBlob()
    pendingStopRef.current = blobPromise
    // The turn is over: a falling pair, played only once the recording has stopped (it must not be recorded).
    blobPromise.then(() => { void playCue('done') }, () => {})
    useStore.getState().setIsSpeaking(false)

    let transcription: Transcription = null
    let failed = false
    try {
      if (specValid) transcription = await spec!.promise
      const emptyHeadStart = specValid && transcription !== null && !transcription.text?.trim()
      if (transcription === null || emptyHeadStart) {
        const blob = await blobPromise
        if (blob && blob.size > 0 && speechMs >= MIN_SPEECH_MS) {
          const second = await apiRef.current.transcribeAudio(blob, language, speechMs)
          if (second !== null) transcription = second
          else if (transcription === null) failed = true
        } else if (transcription === null) {
          failed = true
        }
      }
    } catch (err) {
      console.error('[Conversation] transcription failed', err)
      failed = true
    }
    if (closingRef.current) return
    turnIndexRef.current = turnIndex
    const transcribeMs = Math.round(performance.now() - startedAt)
    const text = transcription?.text?.trim() ?? ''

    const reactions = REACTION_FALLBACKS[language] ?? REACTION_FALLBACKS.en

    // Nothing usable came back. Never turn that into an answer.
    if (!text && !failed) {
      logTurn('')
      emptyTurnsRef.current += 1
      if (emptyTurnsRef.current >= 2) apiRef.current.logEvent('struggle_signal', { reason: 'no_speech_repeat', count: emptyTurnsRef.current, ui: 'v2' })
      if (speechMs >= REAL_SPEECH_MS) {
        // They clearly said something, but nothing usable came back: say so and offer another go, instead of
        // silently starting over (which looks like the app swallowed what they said).
        apiRef.current.logEvent('turn_failed', { stage: 'empty_transcript', speech_ms: speechMs, ui: 'v2' })
        lastTranscriptRef.current = ''
        replyRef.current = null
        setEvaluation({ transcript: '', level: 'retry', reaction: reactions.retry, alternative: null, changedWords: [] })
        send({ type: 'EVALUATION_READY', level: 'retry' })
        return
      }
      // A blip of noise: quietly listen again, and give back the speaking time it was counted as.
      useStore.getState().incrementSpeakingTime(-turnSpeechMsRef.current)
      send({ type: 'TURN_DISCARDED' })
      return
    }

    // The server never answered: say so, and let them try again. Nothing was judged.
    if (failed) {
      apiRef.current.logEvent('transcribe_failed', { ui: 'v2' })
      apiRef.current.logEvent('turn_failed', { stage: 'transcribe', ui: 'v2' })
      logTurn('')
      lastTranscriptRef.current = ''
      replyRef.current = null
      setEvaluation({ transcript: '', level: 'retry', reaction: reactions.retry, alternative: null, changedWords: [] })
      send({ type: 'EVALUATION_READY', level: 'retry' })
      return
    }

    emptyTurnsRef.current = 0
    logTurn(text)
    lastTranscriptRef.current = text

    // Judge the answer. If the judge is unavailable the answer simply counts as fine.
    const judgeStart = performance.now()
    const judged = (await apiRef.current.evaluateAnswer(text)) ?? { level: 'good' as const, alternative: null, changedWords: [] }
    const evaluateMs = Math.round(performance.now() - judgeStart)
    if (closingRef.current) return
    const level = judged.level
    setEvaluation({
      transcript: text,
      level,
      reaction: reactions[level],
      alternative: judged.alternative,
      changedWords: judged.changedWords,
    })
    send({ type: 'EVALUATION_READY', level })
    if (judged.alternative) apiRef.current.logEvent('correction_shown', { level, ui: 'v2' })

    // A real answer moves the conversation on: start the AI's next reply (text and voice) now,
    // while the learner reads the feedback. A "retry" does not: the AI keeps waiting.
    if (level !== 'retry') {
      useStore.getState().addMessage('user', text)
      const pending: PendingReply = {
        promise: apiRef.current.getAiResponse(text, transcription?.detectedLanguage ?? null, { withVoice: true }),
        startedAt: performance.now(),
        transcribeMs,
        evaluateMs,
        endWaitMs: Math.round(startedAt - speechEndedAt),
        speechEndedAt,
        readyAt: null,
      }
      pending.promise.then(() => { pending.readyAt = performance.now() }, () => {})
      replyRef.current = pending
    } else {
      replyRef.current = null
    }
  }, [language, send, stopRecordingAndGetBlob])

  submitTurnRef.current = submitTurn

  // ---- the AI speaks ----
  /** Play the next AI reply (already being fetched), show it, then hand the turn to the learner. */
  const playNextReply = useCallback(async () => {
    const pending = replyRef.current
    replyRef.current = null
    const calledAt = performance.now() // the learner moved on (Continue, or the auto-advance)
    let reply: Reply = null
    try {
      reply = pending ? await pending.promise : null
    } catch {
      reply = null
    }
    if (closingRef.current) return
    if (reply && reply.text.trim()) {
      const text = reply.text.trim()
      setAiLine({ text, translation: '' })
      setShowTranslation(false)
      useStore.getState().addMessage('assistant', text)
      const waitedMs = pending ? Math.round(performance.now() - pending.startedAt) : null
      let audioStartMs: number | null = null
      const playStart = performance.now()
      await apiRef.current.textToSpeech(text, () => { audioStartMs = Math.round(performance.now() - playStart) }, reply.audio ?? undefined)
      // Where the time went, from the end of the learner's sentence to the AI's voice. Read this in the console
      // ("[Timing]"), or in the response_timing event.
      const readyAt = pending?.readyAt ?? null
      const timing = {
        end_wait_ms: pending?.endWaitMs ?? null, // silence waited before the answer was sent
        transcribe_ms: pending?.transcribeMs ?? null,
        evaluate_ms: pending?.evaluateMs ?? null, // the judge
        reply_took_ms: pending && readyAt ? Math.round(readyAt - pending.startedAt) : null, // reply text + voice
        continue_after_ms: pending ? Math.round(calledAt - pending.startedAt) : null, // time on the feedback screen, about
        reply_wait_ms: readyAt ? Math.max(0, Math.round(readyAt - calledAt)) : null, // waited after moving on (0 = was ready)
        audio_start_ms: audioStartMs,
        since_speech_end_ms:
          pending?.speechEndedAt !== undefined && audioStartMs !== null
            ? Math.round(playStart + audioStartMs - pending.speechEndedAt)
            : null,
        ...Object.fromEntries(Object.entries(reply.serverMs ?? {}).map(([k, v]) => [`server_${k}`, v])),
      }
      console.log('[Timing]', JSON.stringify(timing))
      apiRef.current.logEvent('response_timing', {
        ...timing,
        reply_ready_ms: waitedMs,
        voice_with_reply: !!reply.audio,
        ui: 'v2',
      })
    } else {
      // We heard them but no reply came back: go back to listening rather than hang.
      apiRef.current.logEvent('turn_failed', { stage: 'respond', ui: 'v2' })
    }
    if (closingRef.current) return
    if (reply?.wrap) {
      // A natural place to change topic or stop: ask, instead of opening the mic.
      setWrapKind(reply.wrap)
      const s = useStore.getState()
      apiRef.current.logEvent('wrap_offered', { kind: reply.wrap, turns: turnIndexRef.current, speaking_ms: Math.round(s.speakingTime), ui: 'v2' })
      send({ type: 'WRAP_OFFERED' })
      return
    }
    cueNextOpenRef.current = true
    send({ type: 'AI_AUDIO_ENDED' })
  }, [send])

  // ---- start ----
  const begin = useCallback(async () => {
    if (initRef.current) return
    initRef.current = true
    setStartError(null)
    try {
      unlockAudio().catch(() => {})
      const session = await apiRef.current.startSession()
      if (!session) throw new Error('Session start returned no data')
      if (closingRef.current) return
      sessionStartedAtRef.current = Date.now()
      useStore.getState().addMessage('assistant', session.greeting)
      setAiLine({ text: session.greeting, translation: '' })
      setStarted(true)
      await unlockAudio().catch(() => {})
      await sleep(300) // let the audio system settle (iOS)
      if (session.greeting) await apiRef.current.textToSpeech(session.greeting)
      if (!closingRef.current) {
        cueNextOpenRef.current = true
        send({ type: 'AI_AUDIO_ENDED' })
      }
    } catch (err: any) {
      console.error('[Conversation] failed to start', err)
      initRef.current = false
      setStartError(err?.message || 'Failed to start conversation. Please try again.')
    }
  }, [send])

  useEffect(() => {
    if (permission.state !== 'granted' || started || startError) return
    const id = setTimeout(() => { void begin() }, 0)
    return () => clearTimeout(id)
  }, [permission.state, started, startError, begin])

  // Hints for the AI's current line, fetched as soon as it is known so they are ready if needed.
  useEffect(() => {
    if (!sessionId || !aiLine.text) return
    let cancelled = false
    setHints(null)
    setHintPinned(false)
    apiRef.current.getHints().then((h) => { if (!cancelled && h) setHints(h) })
    return () => { cancelled = true }
  }, [sessionId, aiLine.text])

  // Which scenario is this? (Shown in the header.)
  useEffect(() => {
    const s = useStore.getState()
    if (s.customScenario) {
      setScenarioTitle('Custom scenario')
    } else if (s.selectedRoleplayId) {
      const id = s.selectedRoleplayId
      fetch(`${API_BASE}/roleplay/scenarios`)
        .then((r) => r.json())
        .then((d) => {
          for (const cat of d.categories ?? []) {
            for (const sc of cat.scenarios ?? []) if (sc.id === id) setScenarioTitle(sc.name)
          }
        })
        .catch(() => {})
    } else {
      setScenarioTitle(TOPICS.find((t) => t.id === s.selectedTopic)?.name ?? 'Conversation')
    }
  }, [])

  // Leaving the screen any way at all: stop the audio and the mic.
  useEffect(() => () => { stopAllAudio() }, [])

  // ---- what the buttons do ----
  const handleClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    micOnRef.current = false
    takerRef.current.close()
    releaseMic()
    stopAllAudio()
    const s = useStore.getState()
    const st = stateRef.current.name
    const lastState =
      st === 'processing' ? 'processing'
      : st === 'aiSpeaking' ? 'ai_speaking'
      : st === 'userSpeaking' ? 'mid_answer'
      : st === 'feedback' ? 'after_correction'
      : st === 'wrapOffer' ? 'wrap_offer'
      : st === 'hintShown' ? 'suggestions_open'
      : turnIndexRef.current === 0 ? 'before_first_speech'
      : 'waiting_to_speak'
    const { logEvent, endSession } = apiRef.current
    const speakingMs = s.speakingTime
    const hitGoal = speakingMs >= s.targetTime
    const language = s.targetLanguage
    logEvent('conversation_closed', {
      duration_ms: sessionStartedAtRef.current ? Date.now() - sessionStartedAtRef.current : null,
      turns: turnIndexRef.current,
      speaking_ms: Math.round(speakingMs),
      spoke: speakingMs > 0,
      last_state: lastState,
      last_struggle: null,
      ms_since_struggle: null,
      ui: 'v2',
    })
    // Leave them with a kind word on the home screen, and leave RIGHT NOW. Saving the session on the
    // server can take seconds (longer if it is waking up), so that happens in the background.
    if (speakingMs > 0) s.setSessionWrapUp({ speakingMs, hitGoal, languageCode: language })
    s.resetSession()
    s.setScreen('home')
    if (speakingMs > 0) {
      endSession(speakingMs)
        .then((result) => {
          if (result?.completed) {
            cancelTodayReminder()
            if (Capacitor.isNativePlatform() && !hasSeenNotificationPrompt()) useStore.getState().setPendingNotificationPrompt(true)
          }
        })
        .catch((err) => console.error('Error ending session:', err))
    }
  }, [releaseMic])

  const goBack = useCallback(() => {
    const s = useStore.getState()
    s.resetSession()
    s.setScreen('home')
  }, [])

  const replayIdRef = useRef(0)
  const onReplay = useCallback(async () => {
    const name = stateRef.current.name
    const text = lastAiTextRef.current
    if (!text) return
    const micWasOpen = micOnRef.current
    if (name === 'userListening' || name === 'userWaiting' || name === 'hintShown' || name === 'resting') {
      const id = ++replayIdRef.current
      apiRef.current.logEvent('ai_replayed', { ui: 'v2' })
      closeMic()
      send({ type: 'AI_AUDIO_STARTED' })
      // Give the phone a moment to go from "recording" back to "playing", or the start can be cut off or quiet.
      if (micWasOpen) await sleep(MIC_SETTLE_MS)
      await apiRef.current.textToSpeech(text)
      // (If another replay started meanwhile, that one hands the turn back.)
      if (!closingRef.current && replayIdRef.current === id) send({ type: 'AI_AUDIO_ENDED' })
    } else if (name === 'feedback' || name === 'wrapOffer') {
      apiRef.current.logEvent('ai_replayed', { ui: 'v2' })
      await apiRef.current.textToSpeech(text)
    }
  }, [closeMic, send])

  const onToggleTranslate = useCallback(async () => {
    if (showTranslation) {
      setShowTranslation(false)
      return
    }
    setShowTranslation(true)
    const text = lastAiTextRef.current
    if (!text) return
    apiRef.current.logEvent('translate_tapped', { ui: 'v2' })
    const cached = translationCacheRef.current.get(text)
    if (cached) {
      setAiLine((l) => (l.text === text ? { ...l, translation: cached } : l))
      return
    }
    const translated = (await apiRef.current.translateText(text, language, 'en')) || '(Translation unavailable)'
    translationCacheRef.current.set(text, translated)
    setAiLine((l) => (l.text === text ? { ...l, translation: translated } : l))
  }, [showTranslation, language])

  const onShowHint = useCallback(() => {
    apiRef.current.logEvent('suggestions_shown', { trigger: 'tap', ui: 'v2' })
    setHintPinned(true)
    send({ type: 'SHOW_HINT' })
    // The card opens at once (with the "give me a moment" phrase); if the answer never arrived, ask again.
    if (!hintsRef.current?.answer) {
      const line = lastAiTextRef.current
      apiRef.current.getHints().then((h) => { if (h && lastAiTextRef.current === line) setHints(h) })
    }
  }, [send])

  const onPlay = useCallback(async (target: PlayTarget) => {
    const text =
      target === 'hintAnswer' ? hints?.answer
      : target === 'hintStall' ? (hints?.stall || STALL_PHRASES[language] || STALL_PHRASES.en)
      : evaluation?.alternative
    if (!text) return
    if (target === 'alternative') apiRef.current.logEvent('correction_heard', { ui: 'v2' })
    else apiRef.current.logEvent('suggestion_tapped', { index: target === 'hintAnswer' ? 0 : 1, ui: 'v2' })
    // The mic must be off while this plays, or it would hear the playback as the learner.
    const reopen = micOnRef.current
    closeMic()
    setPlaying(target)
    try {
      if (reopen) await sleep(MIC_SETTLE_MS)
      await apiRef.current.textToSpeech(text)
    } finally {
      setPlaying(null)
      const name = stateRef.current.name
      if (reopen && !closingRef.current && (name === 'hintShown' || name === 'userWaiting' || name === 'userListening')) openMic()
    }
  }, [hints, evaluation, language, closeMic, openMic])

  const onContinue = useCallback(() => {
    if (stateRef.current.name !== 'feedback') return
    send({ type: 'CONTINUE' })
    setEvaluation(null)
    void playNextReply()
  }, [send, playNextReply])

  const onTryAgain = useCallback(() => {
    cueNextOpenRef.current = true
    send({ type: 'TRY_AGAIN' })
    setEvaluation(null)
  }, [send])

  const onSkip = useCallback(() => {
    if (stateRef.current.name !== 'feedback') return
    send({ type: 'SKIP' })
    setEvaluation(null)
    // Move on as if they had said "I don't know", so the AI carries on naturally. (This is only
    // sent to the AI; it is not added to the on-screen transcript, because they did not say it.)
    const said = SKIP_UTTERANCES[language] || SKIP_UTTERANCES.en
    replyRef.current = {
      promise: apiRef.current.getAiResponse(said, null, { withVoice: true }),
      startedAt: performance.now(),
      transcribeMs: 0,
    }
    void playNextReply()
  }, [send, playNextReply, language])

  // A fine answer with nothing to study moves on by itself after a short pause. Tapping the
  // screen moves on sooner; touching Replay, Translate or the transcript stops the timer and
  // brings the Continue button back, so nothing is cut off while the learner is using it.
  const autoAdvance = autoContinues(state, !!evaluation?.alternative) && !autoPaused
  useEffect(() => setAutoPaused(false), [evaluation])
  useEffect(() => {
    if (!autoAdvance) return
    const id = window.setTimeout(() => onContinue(), DEFAULT_TURN_CONFIG.autoContinueDelay * 1000)
    return () => window.clearTimeout(id)
  }, [autoAdvance, onContinue])
  // ---- the "keep going / new topic / finish" card ----
  const onKeepGoing = useCallback(() => {
    if (stateRef.current.name !== 'wrapOffer') return
    apiRef.current.logEvent('wrap_keep_going', { kind: wrapKind, ui: 'v2' })
    setWrapKind(null)
    cueNextOpenRef.current = true
    send({ type: 'KEEP_GOING' })
  }, [send, wrapKind])

  const onFinish = useCallback(() => {
    if (stateRef.current.name !== 'wrapOffer') return
    apiRef.current.logEvent('wrap_finish', { kind: wrapKind, ui: 'v2' })
    handleClose()
  }, [handleClose, wrapKind])

  const onNewTopic = useCallback(async () => {
    if (stateRef.current.name !== 'wrapOffer') return
    apiRef.current.logEvent('wrap_new_topic', { kind: wrapKind, ui: 'v2' })
    setWrapKind(null)
    send({ type: 'NEW_TOPIC' }) // she speaks next, as after any reply
    const line = await apiRef.current.newTopic()
    if (closingRef.current) return
    if (line) {
      setAiLine({ text: line.text, translation: '' })
      setShowTranslation(false)
      useStore.getState().addMessage('assistant', line.text)
      await apiRef.current.textToSpeech(line.text, undefined, line.audio ?? undefined)
    }
    // (If no new line could be made, carry on with the old one rather than leave them stuck.)
    if (!closingRef.current) {
      cueNextOpenRef.current = true
      send({ type: 'AI_AUDIO_ENDED' })
    }
  }, [send, wrapKind])

  const onScreenTap = useCallback(
    (e: React.MouseEvent) => {
      if (!autoAdvance) return
      if ((e.target as HTMLElement).closest('button, a, [role="dialog"]')) setAutoPaused(true)
      else onContinue()
    },
    [autoAdvance, onContinue],
  )

  // The hint card never waits on the server: the "give me a moment" phrase is always there, and the
  // suggested answer fills in when it arrives.
  const shownHints: Hints = {
    answer: hints?.answer ?? '',
    stall: hints?.stall || STALL_PHRASES[language] || STALL_PHRASES.en,
  }
  const hintsRef = useRef<Hints | null>(null)
  hintsRef.current = hints

  // The transcript sheet reads the conversation so far.
  const messages = useMemo(
    () => conversationHistory.map((m) => ({ role: m.role === 'assistant' ? ('ai' as const) : ('you' as const), text: m.content })),
    [conversationHistory],
  )

  if (!started) {
    return (
      <MicGate
        permission={permission.state}
        isNativeIos={permission.isNativeIos}
        startError={startError}
        onRequest={permission.request}
        onOpenSettings={permission.openSettings}
        onRetryStart={() => { initRef.current = false; setStartError(null) }}
        onGoBack={goBack}
      />
    )
  }

  return (
    <div className="conv-fullscreen" onClick={onScreenTap}>
      <ConversationView
        state={state}
        language={language}
        scenarioTitle={scenarioTitle}
        personaName={PERSONA_NAMES[language] ?? 'Anouk'}
        aiLine={aiLine}
        showTranslation={showTranslation}
        evaluation={evaluation}
        hints={shownHints}
        hintPinned={hintPinned}
        micLevel={micLevel}
        playing={playing}
        showLiveTranscript={DEFAULT_TURN_CONFIG.showLiveTranscript}
        autoContinue={autoAdvance}
        wrapKind={wrapKind}
        canChangeTopic={!isRoleplay}
        goalReached={speakingTime >= targetTime}
        onKeepGoing={onKeepGoing}
        onNewTopic={onNewTopic}
        onFinish={onFinish}
        onClose={handleClose}
        onOpenTranscript={() => { apiRef.current.logEvent('history_opened', { ui: 'v2' }); setSheetOpen(true) }}
        onReplay={onReplay}
        onToggleTranslate={onToggleTranslate}
        onTapAvatar={() => send({ type: 'TAP_AVATAR' })}
        onShowHint={onShowHint}
        onDone={onDone}
        onOpenSettings={() => setSettingsOpen(true)}
        onPlay={onPlay}
        onContinue={onContinue}
        onTryAgain={onTryAgain}
        onSkip={onSkip}
      />
      <SettingsSheet open={settingsOpen} soundOn={cuesEnabled} onToggleSound={onToggleSound} onClose={() => setSettingsOpen(false)} />
      <TranscriptSheet open={sheetOpen} language={language} onClose={() => setSheetOpen(false)} messages={messages} />
      {import.meta.env.DEV && <DebugOverlay state={state} snapshot={debugSnap} />}
    </div>
  )
}
