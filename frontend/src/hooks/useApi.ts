import { useCallback } from 'react'
import { useStore, Improvement, Correction } from '../store'

const API_BASE = '/api'

// Module-level audio tracking for interruptibility
let currentAudio: HTMLAudioElement | null = null
let audioUrls: string[] = [] // Track URLs for cleanup
let recentFillers: string[] = [] // Track recent fillers to avoid repetition

// Map UI speed to actual TTS speed
// Speed is applied server-side (OpenAI) or client-side playbackRate (ElevenLabs)
// OpenAI fallback speed map (server-side)
const OPENAI_SPEED_MAP: Record<number, number> = {
  0.8: 0.55,  // Slow
  0.9: 0.66,  // Natural  
  1.0: 0.72,  // Normal
}

// Hindi uses moderate TTS speed with natural pauses
const HINDI_SPEED_MAP: Record<number, number> = {
  0.8: 0.70,  // Slow
  0.9: 0.80,  // Natural
  1.0: 0.85,  // Normal - still natural with pauses
}

// Client-side playback speed for ElevenLabs (via playbackRate)
// ElevenLabs generates at normal speed, we can adjust client-side
const ELEVENLABS_PLAYBACK_RATE: Record<number, number> = {
  0.8: 0.8,   // Slow
  0.9: 0.9,   // Natural
  1.0: 1.0,   // Normal
}

function getActualSpeed(uiSpeed: number, language: string): number {
  // For OpenAI fallback (server-side speed)
  if (language === 'hi') {
    return HINDI_SPEED_MAP[uiSpeed] || 0.85
  }
  return OPENAI_SPEED_MAP[uiSpeed] || 0.72
}

function getPlaybackRate(uiSpeed: number): number {
  // For ElevenLabs (client-side playbackRate)
  return ELEVENLABS_PLAYBACK_RATE[uiSpeed] || 1.0
}

// Web Audio API context for mobile - more reliable than HTMLAudioElement
let audioContext: AudioContext | null = null
let audioUnlocked = false

export function unlockAudio() {
  if (audioUnlocked && audioContext) return
  
  try {
    // Create or resume AudioContext
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    
    if (audioContext.state === 'suspended') {
      audioContext.resume()
    }
    
    // Also play a silent sound with HTMLAudioElement as backup
    const silentAudio = new Audio('data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//uQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAA5TEFNRTMuMTAwAc0AAAAAAAAAABSAJAiqQgAAgAAAYYTX7sEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//uQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
    silentAudio.play().catch(() => {})
    
    audioUnlocked = true
    console.log('[Audio] Mobile audio unlocked, context state:', audioContext.state)
  } catch (e) {
    console.error('[Audio] Failed to unlock:', e)
  }
}

// Get or create audio context
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume()
  }
  return audioContext
}

// Stop all audio immediately (for interruption)
export function stopAllAudio() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }
  // Cleanup URLs
  audioUrls.forEach(url => URL.revokeObjectURL(url))
  audioUrls = []
}

export function useApi() {
  const {
    userId,
    targetLanguage,
    sessionId,
    setSessionId,
    setUserStats,
    setAiMessage,
    appendAiMessage,
    setImprovements,
    setIsAiSpeaking,
    audioSpeed,
    setCurrentCorrection,
    selectedTopic,
  } = useStore()

  // Fetch user stats
  const fetchUserStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/user/${userId}/stats`)
      if (res.ok) {
        const data = await res.json()
        setUserStats(data.streak, data.completed_today)
      }
    } catch (err) {
      console.error('Failed to fetch user stats:', err)
    }
  }, [userId, setUserStats])

  // Start a new session
  const startSession = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          target_language: targetLanguage,
          topic: selectedTopic || 'random',
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setSessionId(data.session_id)
        setAiMessage(data.greeting)
        return data
      }
    } catch (err) {
      console.error('Failed to start session:', err)
    }
    return null
  }, [userId, targetLanguage, selectedTopic, setSessionId, setAiMessage])

  // End session and get feedback
  const endSession = useCallback(async (totalSpeakingTime: number) => {
    if (!sessionId) return null

    stopAllAudio()
    setIsAiSpeaking(false)

    try {
      const res = await fetch(`${API_BASE}/session/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          total_speaking_time: totalSpeakingTime / 1000,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setUserStats(data.streak, data.completed)
        if (data.feedback?.improvements) {
          setImprovements(data.feedback.improvements as Improvement[])
        }
        return data
      }
    } catch (err) {
      console.error('Failed to end session:', err)
    }
    return null
  }, [sessionId, setUserStats, setImprovements, setIsAiSpeaking])

  // Transcribe audio with language hint
  const transcribeAudio = useCallback(async (audioBlob: Blob): Promise<string | null> => {
    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'audio.webm')

      const res = await fetch(`${API_BASE}/transcribe?language=${targetLanguage}`, {
        method: 'POST',
        body: formData,
      })

      if (res.ok) {
        const data = await res.json()
        return data.transcript
      }
    } catch (err) {
      console.error('Transcription error:', err)
    }
    return null
  }, [targetLanguage])

  // Get AI response (streaming)
  const getAiResponse = useCallback(async (transcript: string): Promise<string | null> => {
    if (!sessionId) return null

    try {
      const res = await fetch(`${API_BASE}/conversation/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          transcript,
          is_partial: false,
        }),
      })

      if (!res.ok) return null

      const reader = res.body?.getReader()
      if (!reader) return null

      const decoder = new TextDecoder()
      let fullResponse = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.text) {
                appendAiMessage(data.text)
                fullResponse += data.text
              }
              if (data.done && data.full_response) {
                fullResponse = data.full_response
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      return fullResponse
    } catch (err) {
      console.error('AI response error:', err)
    }
    return null
  }, [sessionId, appendAiMessage])

  // Text to speech - uses regular TTS endpoint (handles ElevenLabs/OpenAI fallback server-side)
  const textToSpeech = useCallback(async (text: string): Promise<void> => {
    // Stop any currently playing audio
    stopAllAudio()

    setIsAiSpeaking(true)
    
    console.log(`[TTS] Speaking: ${text.slice(0, 80)}...`)

    try {
      // Use regular TTS endpoint - it handles ElevenLabs with OpenAI fallback automatically
      // This is more reliable than trying streaming first
      const actualSpeed = getActualSpeed(audioSpeed, targetLanguage)
      await playRegularTTS(text, targetLanguage, actualSpeed, setIsAiSpeaking)
    } catch (err) {
      console.error('[TTS] Error:', err)
      setIsAiSpeaking(false)
    }
  }, [targetLanguage, audioSpeed, setIsAiSpeaking])

  // Regular TTS - sends full text and plays audio
  const playRegularTTS = async (
    text: string,
    language: string,
    speed: number,
    setIsAiSpeaking: (speaking: boolean) => void
  ) => {
    console.log(`[TTS] Sending to TTS API: "${text}"`)
    
    try {
      const res = await fetch(`${API_BASE}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language, speed }),
      })

      if (!res.ok) {
        setIsAiSpeaking(false)
        return
      }

      const data = await res.json()
      const audioData = atob(data.audio)
      const audioArray = new Uint8Array(audioData.length)
      for (let i = 0; i < audioData.length; i++) {
        audioArray[i] = audioData.charCodeAt(i)
      }
      const audioBlob = new Blob([audioArray], { type: 'audio/mp3' })
      const audioUrl = URL.createObjectURL(audioBlob)

      // Apply playback speed (10% slower for more natural pace)
      const playbackRate = getPlaybackRate(audioSpeed)
      
      // Try Web Audio API first (more reliable on mobile), fallback to HTMLAudioElement
      try {
        const ctx = getAudioContext()
        const arrayBuffer = await audioBlob.arrayBuffer()
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
        
        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        source.playbackRate.value = playbackRate  // Apply speed control
        source.connect(ctx.destination)
        
        await new Promise<void>((resolve) => {
          source.onended = () => {
            setIsAiSpeaking(false)
            URL.revokeObjectURL(audioUrl)
            resolve()
          }
          source.start(0)
          console.log(`[TTS] Playing via Web Audio API at ${playbackRate}x speed`)
        })
      } catch (webAudioError) {
        console.log('[TTS] Web Audio failed, trying HTMLAudioElement:', webAudioError)
        
        // Fallback to HTMLAudioElement with playbackRate
        await new Promise<void>((resolve) => {
          const audio = new Audio(audioUrl)
          currentAudio = audio
          audio.playbackRate = playbackRate  // Apply speed control
          audio.setAttribute('playsinline', 'true')
          audio.preload = 'auto'

          audio.onended = () => {
            setIsAiSpeaking(false)
            URL.revokeObjectURL(audioUrl)
            currentAudio = null
            resolve()
          }

          audio.onerror = (e) => {
            console.error('[TTS] Audio error:', e)
            setIsAiSpeaking(false)
            URL.revokeObjectURL(audioUrl)
            currentAudio = null
            resolve()
          }

          audio.play().catch((err) => {
            console.error('[TTS] Play failed:', err)
            setIsAiSpeaking(false)
            currentAudio = null
            resolve()
          })
        })
      }
    } catch (err) {
      console.error('Fallback TTS error:', err)
      setIsAiSpeaking(false)
    }
  }

  // Generate audio for improvement (uses regular TTS)
  const generateImprovementAudio = useCallback(async (text: string): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          language: targetLanguage,
          speed: 0.6, // Slower for learning
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const audioData = atob(data.audio)
        const audioArray = new Uint8Array(audioData.length)
        for (let i = 0; i < audioData.length; i++) {
          audioArray[i] = audioData.charCodeAt(i)
        }
        const audioBlob = new Blob([audioArray], { type: 'audio/mp3' })
        return URL.createObjectURL(audioBlob)
      }
    } catch (err) {
      console.error('Improvement audio error:', err)
    }
    return null
  }, [targetLanguage])

  // Stop any playing audio
  const stopAudio = useCallback(() => {
    stopAllAudio()
    setIsAiSpeaking(false)
  }, [setIsAiSpeaking])

  // Play a thinking filler while processing (~30% chance)
  const playThinkingFiller = useCallback(async (): Promise<void> => {
    // Only play filler 30% of the time
    if (Math.random() > 0.3) return
    
    try {
      const actualSpeed = getActualSpeed(audioSpeed, targetLanguage)
      
      const res = await fetch(`${API_BASE}/tts/filler`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: targetLanguage,
          speed: actualSpeed,
          exclude: recentFillers, // Avoid recently used fillers
        }),
      })
      
      if (!res.ok) return
      
      const data = await res.json()
      
      // Track this filler to avoid repetition
      if (data.text) {
        recentFillers.push(data.text)
        // Keep only last 4 fillers
        if (recentFillers.length > 4) {
          recentFillers.shift()
        }
      }
      
      const audioData = atob(data.audio)
      const audioArray = new Uint8Array(audioData.length)
      for (let i = 0; i < audioData.length; i++) {
        audioArray[i] = audioData.charCodeAt(i)
      }
      const audioBlob = new Blob([audioArray], { type: 'audio/mp3' })
      const audioUrl = URL.createObjectURL(audioBlob)
      
      // Play filler (don't wait for it to finish)
      const audio = new Audio(audioUrl)
      currentAudio = audio
      setIsAiSpeaking(true)
      
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl)
        // Don't set isAiSpeaking to false - main response will handle that
      }
      
      audio.play().catch(() => {
        URL.revokeObjectURL(audioUrl)
      })
      
    } catch (err) {
      console.error('Filler error:', err)
    }
  }, [targetLanguage, audioSpeed, setIsAiSpeaking])

  // Analyze user speech for corrections
  const analyzeUserSpeech = useCallback(async (transcript: string): Promise<Correction | null> => {
    try {
      const res = await fetch(`${API_BASE}/analyze-speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          target_language: targetLanguage,
          user_language: 'en', // Explanations in English
        }),
      })

      if (!res.ok) return null

      const data = await res.json()
      
      if (!data.has_correction) {
        return null
      }

      // Create audio URL from base64
      let audioUrl: string | undefined
      if (data.audio) {
        const audioData = atob(data.audio)
        const audioArray = new Uint8Array(audioData.length)
        for (let i = 0; i < audioData.length; i++) {
          audioArray[i] = audioData.charCodeAt(i)
        }
        const audioBlob = new Blob([audioArray], { type: 'audio/mp3' })
        audioUrl = URL.createObjectURL(audioBlob)
      }

      const correction: Correction = {
        original: data.original,
        corrected: data.corrected,
        explanation: data.explanation,
        audioUrl,
      }

      setCurrentCorrection(correction)
      return correction
    } catch (err) {
      console.error('Speech analysis error:', err)
      return null
    }
  }, [targetLanguage, setCurrentCorrection])

  // Clear current correction
  const clearCorrection = useCallback(() => {
    setCurrentCorrection(null)
  }, [setCurrentCorrection])

  return {
    fetchUserStats,
    startSession,
    endSession,
    transcribeAudio,
    getAiResponse,
    textToSpeech,
    generateImprovementAudio,
    stopAudio,
    playThinkingFiller,
    analyzeUserSpeech,
    clearCorrection,
  }
}
