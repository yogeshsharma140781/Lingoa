import { useEffect, useRef, useCallback, useState } from 'react'
import { useStore } from '../store'
import { stopAllAudio } from './useApi'

interface UseVoiceActivityOptions {
  silenceThreshold?: number
  silenceTimeout?: number
  onSpeechStart?: () => void
  onSpeechEnd?: (duration: number) => void
  onAudioData?: (blob: Blob) => void
}

export function useVoiceActivity(options: UseVoiceActivityOptions = {}) {
  const {
    silenceThreshold = -15, // Very high threshold - requires clear speech, strongly filters background noise
    silenceTimeout = 2000,
    onSpeechStart,
    onSpeechEnd,
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
      
      mimeTypeRef.current = mimeType
      mediaRecorderRef.current = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      chunksRef.current = []

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      // Start recording immediately
      mediaRecorderRef.current.start(500)

      // Start analyzing
      setIsRecording(true)
      isSpeakingRef.current = false
      silenceStartRef.current = 0
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

    if (db > currentThreshold) {
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
        setIsSpeaking(true)
        onSpeechStart?.()
      }

      speechDurationRef.current = now - speechStartTimeRef.current
    } else {
      // Silence detected
      if (isSpeakingRef.current) {
        if (silenceStartRef.current === 0) {
          silenceStartRef.current = now
        }

        if (now - silenceStartRef.current > currentTimeout) {
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
    getRecordedBlob,
    clearRecording,
  }
}
