import { useEffect, useRef, useCallback, useState } from 'react'
import { useStore } from '../store'
import { stopAllAudio } from './useApi'

interface UseVoiceActivityOptions {
  silenceThreshold?: number
  silenceTimeout?: number
  chunkIntervalMs?: number
  onSpeechStart?: () => void
  onSpeechEnd?: (duration: number) => void
  onAudioData?: (blob: Blob) => void
  // Called when a stretch that looked like speech turned out to be steady background noise
  // (the user never actually spoke). The caller should forget that it "heard speech".
  onNoiseOnly?: () => void
}

export function useVoiceActivity(options: UseVoiceActivityOptions = {}) {
  const {
    silenceThreshold = -15, // Very high threshold - requires clear speech, strongly filters background noise
    silenceTimeout = 2000,
    chunkIntervalMs = 500,
    onSpeechStart,
    onSpeechEnd,
    onAudioData,
    onNoiseOnly,
  } = options

  const { setIsSpeaking, setMicPermission, isAiSpeaking } = useStore()
  
  const [isRecording, setIsRecording] = useState(false)
  const [volume, setVolume] = useState(0)
  
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  
  const isSpeakingRef = useRef(false)
  const speechStartTimeRef = useRef<number>(0)
  const silenceStartRef = useRef<number>(0)
  const animationFrameRef = useRef<number>(0)
  const speechDurationRef = useRef<number>(0)
  // Adaptive ambient noise floor (dB-like scale, see analyzeAudio). A single fixed
  // threshold works in a quiet room but false-triggers on steady background noise
  // (fan, traffic, echo) in a real environment. Instead we track a slow-moving
  // estimate of the room's actual quiet level and require speech to be clearly
  // louder than THAT, not just louder than a hardcoded number picked in a quiet
  // office. Starts low (assume quiet) and rises to match reality within ~1-2s.
  const noiseFloorRef = useRef<number>(-100)
  // Loudest recent level while the user is speaking (decays slowly). "Silence" is judged
  // against this too, so constant background noise that sits above the room baseline
  // doesn't make the user look like they're still talking after they've stopped.
  const speechPeakRef = useRef<number>(-100)
  // Recent levels while "speaking", to spot a steady, unchanging level (= noise, not speech).
  const steadyWindowRef = useRef<{ t: number; db: number }[]>([])
  const episodeMaxRef = useRef<number>(-100) // loudest level since this stretch of "speech" began
  const recordingStartedAtRef = useRef<number>(0)
  const episodeAtMicOpenRef = useRef(false) // this stretch of "speech" began right as the mic opened
  const onNoiseOnlyRef = useRef(onNoiseOnly)
  onNoiseOnlyRef.current = onNoiseOnly
  // Safari/WKWebView often doesn't support audio/webm; prefer mp4/m4a when available.
  const mimeTypeRef = useRef<string>('audio/mp4')
  
  // Use refs to avoid stale closures in the animation loop
  const silenceThresholdRef = useRef(silenceThreshold)
  const silenceTimeoutRef = useRef(silenceTimeout)
  const isAiSpeakingRef = useRef(isAiSpeaking)
  
  // Keep refs in sync with props
  useEffect(() => {
    silenceThresholdRef.current = silenceThreshold
  }, [silenceThreshold])
  
  useEffect(() => {
    silenceTimeoutRef.current = silenceTimeout
  }, [silenceTimeout])
  
  useEffect(() => {
    isAiSpeakingRef.current = isAiSpeaking
  }, [isAiSpeaking])

  const startRecording = useCallback(async () => {
    // Clean up any existing recording first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close()
    }
    
    // Reset chunks
    chunksRef.current = []
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      })
      
      setMicPermission('granted')
      streamRef.current = stream

      // Setup audio analysis
      audioContextRef.current = new AudioContext()
      analyserRef.current = audioContextRef.current.createAnalyser()
      analyserRef.current.fftSize = 256
      analyserRef.current.smoothingTimeConstant = 0.8

      const source = audioContextRef.current.createMediaStreamSource(stream)
      source.connect(analyserRef.current)

      // Setup media recorder
      const pickMimeType = () => {
        const candidates = [
          // Safari / iOS (usually produces .m4a container via audio/mp4)
          'audio/mp4;codecs=mp4a.40.2',
          'audio/mp4',
          // Chromium
          'audio/webm;codecs=opus',
          'audio/webm',
        ]
        for (const c of candidates) {
          try {
            if (MediaRecorder.isTypeSupported(c)) return c
          } catch {
            // ignore
          }
        }
        return '' // let browser pick default
      }

      const mimeType = pickMimeType()
      console.log('[Recorder] Selected mimeType:', mimeType || '(browser default)')
      
      mimeTypeRef.current = mimeType || 'audio/webm' // fallback for blob type
      mediaRecorderRef.current = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      chunksRef.current = []

      // Log actual mimeType the recorder is using
      console.log('[Recorder] Actual recorder mimeType:', mediaRecorderRef.current.mimeType)

      mediaRecorderRef.current.ondataavailable = (e) => {
        console.log('[Recorder] ondataavailable:', e.data.size, 'bytes')
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
          if (onAudioData) {
            onAudioData(e.data)
          }
        }
      }

      mediaRecorderRef.current.onerror = (e) => {
        console.error('[Recorder] onerror:', e)
      }

      // Start recording immediately
      console.log('[Recorder] Starting recording...')
      mediaRecorderRef.current.start(chunkIntervalMs)

      // Start analyzing
      setIsRecording(true)
      isSpeakingRef.current = false
      silenceStartRef.current = 0
      // Recalibrate to this turn's ambient noise from scratch - the room/environment
      // may have changed since the last turn.
      noiseFloorRef.current = -100
      speechPeakRef.current = -100
      episodeMaxRef.current = -100
      steadyWindowRef.current = []
      recordingStartedAtRef.current = Date.now()
      analyzeAudio()

    } catch (err) {
      console.error('Microphone access error:', err)
      setMicPermission('denied')
    }
  }, [setMicPermission])

  const stopRecording = useCallback(() => {
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = 0
    }

    // Stop media recorder
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }

    setIsRecording(false)
    setIsSpeaking(false)
    isSpeakingRef.current = false
  }, [setIsSpeaking])

  const cleanupMedia = useCallback(() => {
    // Stop stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    setIsRecording(false)
    setIsSpeaking(false)
    isSpeakingRef.current = false
  }, [setIsSpeaking])

  // Reliable stop + blob retrieval (waits for MediaRecorder to flush final chunk).
  const stopRecordingAndGetBlob = useCallback(async (): Promise<Blob | null> => {
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = 0
    }

    const recorder = mediaRecorderRef.current

    const buildBlob = () => {
      console.log('[Recorder] buildBlob: chunks count =', chunksRef.current.length)
      if (chunksRef.current.length > 0) {
        const totalSize = chunksRef.current.reduce((acc, c) => acc + c.size, 0)
        console.log('[Recorder] buildBlob: total chunk bytes =', totalSize)
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current })
        console.log('[Recorder] buildBlob: final blob size =', blob.size, 'type =', blob.type)
        chunksRef.current = []
        return blob
      }
      console.warn('[Recorder] buildBlob: NO CHUNKS!')
      return null
    }

    if (!recorder) {
      const blob = buildBlob()
      cleanupMedia()
      return blob
    }

    // If already inactive, just build what we have.
    if (recorder.state === 'inactive') {
      const blob = buildBlob()
      cleanupMedia()
      return blob
    }

    return await new Promise<Blob | null>((resolve) => {
      let settled = false

      const finish = () => {
        if (settled) return
        settled = true
        const blob = buildBlob()
        cleanupMedia()
        resolve(blob)
      }

      const timeoutId = window.setTimeout(() => {
        console.warn('[Recorder] stop timeout; finishing with available chunks')
        finish()
      }, 2500)

      const onStop = () => {
        window.clearTimeout(timeoutId)
        finish()
      }

      const onError = () => {
        window.clearTimeout(timeoutId)
        console.warn('[Recorder] error while stopping; finishing with available chunks')
        finish()
      }

      recorder.addEventListener('stop', onStop, { once: true })
      recorder.addEventListener('error', onError, { once: true } as any)

      try {
        recorder.stop()
      } catch (e) {
        console.warn('[Recorder] stop() threw; finishing with available chunks', e)
        window.clearTimeout(timeoutId)
        finish()
      }
    })
  }, [cleanupMedia])

  // Everything recorded so far, WITHOUT stopping or clearing: the recording carries on. Used to
  // start transcribing while the user might still be about to say more (they can cancel it).
  const getSnapshotBlob = useCallback(async (): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') return null
    // Ask the recorder to hand over what it has buffered, so the end of the sentence is included.
    await new Promise<void>((resolve) => {
      const done = () => resolve()
      recorder.addEventListener('dataavailable', done, { once: true })
      try {
        recorder.requestData()
      } catch {
        resolve()
      }
      window.setTimeout(done, 500) // never wait on it for long
    })
    if (chunksRef.current.length === 0) return null
    return new Blob(chunksRef.current, { type: mimeTypeRef.current })
  }, [])

  // Get all recorded audio and clear
  const getRecordedBlob = useCallback(() => {
    if (chunksRef.current.length > 0) {
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current })
      chunksRef.current = [] // Clear after getting
      return blob
    }
    return null
  }, [])

  // Clear recording without returning
  const clearRecording = useCallback(() => {
    chunksRef.current = []
  }, [])

  const analyzeAudio = useCallback(() => {
    if (!analyserRef.current) return

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
    analyserRef.current.getByteFrequencyData(dataArray)

    // Calculate average volume
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
    const normalizedVolume = average / 255
    setVolume(normalizedVolume)

    // Convert to dB-like scale
    const db = average > 0 ? 20 * Math.log10(average / 128) : -100

    const now = Date.now()

    // Read current values from refs to avoid stale closures
    const currentThreshold = silenceThresholdRef.current
    const currentTimeout = silenceTimeoutRef.current

    // How much louder than the room's own ambient noise a sound needs to be
    // before we treat it as speech rather than background hum/traffic/echo.
    const NOISE_MARGIN_DB = 9
    // Effective threshold is whichever is stricter: the configured baseline
    // (tuned for a quiet room) or the adaptive floor + margin (for a noisy one).
    const effectiveThreshold = Math.max(currentThreshold, noiseFloorRef.current + NOISE_MARGIN_DB)

    // Noise floor: falls quickly (the room got quieter), rises slowly (so a soft voice just under
    // the threshold isn't absorbed into "noise"). The very first estimate converges fast.
    const learnFloor = (level: number) => {
      const floor = noiseFloorRef.current
      const rate = floor < -90 ? 0.15 : level < floor ? 0.05 : 0.005
      noiseFloorRef.current = floor * (1 - rate) + level * rate
    }

    // While someone is speaking, also count as "silence" anything well below their own recent
    // peak. (This meter is compressive: ~7 units is roughly a 2-3x drop in signal.)
    const RELATIVE_SILENCE_DB = 7
    const PEAK_DECAY_PER_FRAME = 0.02 // ~1 unit per second
    // A level that moves less than this over ~1.3s is a hum or hiss, not a voice (speech swings far more).
    const STEADY_RANGE_DB = 3
    // If the loudest moment was less than this above the steady level, nobody actually spoke.
    const NOISE_ONLY_GAP_DB = 3
    const NOISE_ONLY_STEADY_MS = 2500
    const NOISE_ONLY_LATE_STEADY_MS = 6000
    const silenceCut = isSpeakingRef.current
      ? Math.max(effectiveThreshold, speechPeakRef.current - RELATIVE_SILENCE_DB)
      : effectiveThreshold

    if (db > silenceCut) {
      // Sound detected
      silenceStartRef.current = 0

      // If AI is speaking and user starts talking, interrupt AI
      if (isAiSpeakingRef.current) {
        stopAllAudio()
        useStore.getState().setIsAiSpeaking(false)
      }

      if (!isSpeakingRef.current) {
        isSpeakingRef.current = true
        speechStartTimeRef.current = now
        speechPeakRef.current = db
        episodeMaxRef.current = db
        episodeAtMicOpenRef.current = now - recordingStartedAtRef.current < 1500
        steadyWindowRef.current = []
        setIsSpeaking(true)
        onSpeechStart?.()
      }

      speechPeakRef.current = Math.max(speechPeakRef.current - PEAK_DECAY_PER_FRAME, db)
      episodeMaxRef.current = Math.max(episodeMaxRef.current, db)
      speechDurationRef.current = now - speechStartTimeRef.current

      // Steady noise looks like endless speech: a level that stays put (real speech rises and
      // falls with every syllable). Two cases, both based on a level that barely moves:
      //  1. They spoke (something clearly louder came earlier) and a steady plateau followed:
      //     they've finished, in a noisy room. End the speech and learn the plateau as the floor.
      //  2. Nothing ever rose above the plateau: it was only noise. Needs longer to be sure, and
      //     the caller is told to forget that it "heard speech".
      const win = steadyWindowRef.current
      win.push({ t: now, db })
      while (win.length > 0 && now - win[0].t > NOISE_ONLY_LATE_STEADY_MS) win.shift()
      const spanMs = now - win[0].t
      const rangeSince = (fromT: number) => {
        let lo = Infinity
        let hi = -Infinity
        let sum = 0
        let n = 0
        for (const s of win) {
          if (s.t < fromT) continue
          lo = Math.min(lo, s.db)
          hi = Math.max(hi, s.db)
          sum += s.db
          n += 1
        }
        return { range: hi - lo, mean: n ? sum / n : db }
      }
      let endedAs: 'speech' | 'noise' | null = null
      let steadyMean = db
      if (spanMs >= 1300) {
        const recent = rangeSince(now - 1300)
        if (recent.range < STEADY_RANGE_DB) {
          if (episodeMaxRef.current - recent.mean >= NOISE_ONLY_GAP_DB) {
            endedAs = 'speech'
            // Never let the floor climb to where their own loudest moment wouldn't clear it.
            steadyMean = Math.min(recent.mean, episodeMaxRef.current - NOISE_MARGIN_DB - 0.5)
          } else {
            // Only noise, no clear voice. If it was already there as the mic opened, a short
            // steady stretch is enough; noise that starts later (a fan switching on) needs far
            // longer, so a loud-but-even stretch of real speech is never mistaken for it.
            const needMs = episodeAtMicOpenRef.current ? NOISE_ONLY_STEADY_MS : NOISE_ONLY_LATE_STEADY_MS
            const long = spanMs >= needMs ? rangeSince(now - needMs) : null
            if (long && long.range < STEADY_RANGE_DB) {
              endedAs = 'noise'
              steadyMean = long.mean
            }
          }
        }
      }
      if (endedAs) {
        noiseFloorRef.current = steadyMean
        const spokenMs = speechDurationRef.current
        isSpeakingRef.current = false
        silenceStartRef.current = 0
        speechDurationRef.current = 0
        speechPeakRef.current = -100
        steadyWindowRef.current = []
        setIsSpeaking(false)
        if (endedAs === 'noise') onNoiseOnlyRef.current?.()
        else onSpeechEnd?.(spokenMs)
      }
    } else {
      // Silence (relative to the room) detected.
      // Only let the ambient floor drift toward what we're hearing while we're NOT
      // mid-speech, so a quiet dip within a sentence doesn't drag the floor down,
      // and loud speech itself never gets absorbed into "this is just noise."
      if (!isSpeakingRef.current) {
        learnFloor(db)
      }

      if (isSpeakingRef.current) {
        if (silenceStartRef.current === 0) {
          silenceStartRef.current = now
        }
        // Once it's been quiet (relative to their speech) for a moment, that level is the
        // room, not a dip between words: learn it as the noise floor. This is what stops steady
        // noise above the baseline from counting as "speech" again the instant they stop.
        // (Never let the floor climb to where their own loudest moment wouldn't clear it.)
        if (now - silenceStartRef.current > 300) {
          learnFloor(db)
          noiseFloorRef.current = Math.min(noiseFloorRef.current, episodeMaxRef.current - NOISE_MARGIN_DB - 0.5)
        }

        if (now - silenceStartRef.current > currentTimeout) {
          // They've stopped. If the room is still louder than the speech threshold (steady noise),
          // learn that level right now - otherwise it would count as speech again on the very next
          // frame and the turn would never end. (Never above where their own peak wouldn't clear it.)
          if (db > effectiveThreshold) {
            noiseFloorRef.current = Math.min(db, episodeMaxRef.current - NOISE_MARGIN_DB - 0.5)
          }
          isSpeakingRef.current = false
          setIsSpeaking(false)
          onSpeechEnd?.(speechDurationRef.current)
          speechDurationRef.current = 0
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio)
  }, [setIsSpeaking, onSpeechStart, onSpeechEnd]) // Removed stale-prone deps, using refs instead

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close()
      }
    }
  }, [])

  return {
    isRecording,
    volume,
    startRecording,
    stopRecording,
    stopRecordingAndGetBlob,
    getSnapshotBlob,
    getRecordedBlob,
    clearRecording,
  }
}
