import { useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { useStore, Improvement, Correction } from '../store'

// API base URL - use full URL for iOS, relative for web
export const getApiBase = () => {
  if (Capacitor.isNativePlatform()) {
    // For iOS, use the backend URL from environment or Capacitor config
    // Update this with your actual Render backend URL (e.g., 'https://lingoa-xxxx.onrender.com')
    // You can also set it via Capacitor config server.url
    const backendUrl = (window as any).__API_URL__ || 'https://lingoa.onrender.com'
    return `${backendUrl}/api`
  }
  // For web, use relative URL (works with proxy in dev, or same origin in prod)
  return '/api'
}

export const API_BASE = getApiBase()

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

export async function unlockAudio(): Promise<void> {
  if (audioUnlocked && audioContext && audioContext.state === 'running') {
    return Promise.resolve()
  }
  
  // Add timeout to prevent hanging
  return Promise.race([
    (async () => {
      try {
        // Create or resume AudioContext
        if (!audioContext) {
          audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
        }
        
        // On iOS, we need to resume the context and it must be in response to user interaction
        if (audioContext.state === 'suspended') {
          await Promise.race([
            audioContext.resume(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('AudioContext resume timeout')), 2000))
          ])
          console.log('[Audio] AudioContext resumed, state:', audioContext.state)
        }
        
        // Also play a silent sound with HTMLAudioElement as backup (iOS requires this)
        const silentAudio = new Audio('data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//uQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAA5TEFNRTMuMTAwAc0AAAAAAAAAABSAJAiqQgAAgAAAYYTX7sEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//uQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
        silentAudio.volume = 0.01 // Very quiet but not silent
        
        try {
          // Add timeout for audio play
          await Promise.race([
            silentAudio.play(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Silent audio play timeout')), 2000))
          ])
          console.log('[Audio] Silent audio played successfully')
        } catch (e) {
          console.warn('[Audio] Silent audio play failed (may need user interaction):', e)
          // Still continue - the context resume might be enough
        }
        
        // Wait a bit to ensure audio context is fully ready (especially on iOS)
        await new Promise(resolve => setTimeout(resolve, 100))
        
        audioUnlocked = true
        console.log('[Audio] Mobile audio unlocked, context state:', audioContext.state)
      } catch (e) {
        console.error('[Audio] Failed to unlock:', e)
        // Don't throw - just log and continue, audio might still work
        audioUnlocked = true // Mark as unlocked anyway to prevent retry loops
      }
    })(),
    new Promise<void>((_, reject) => 
      setTimeout(() => reject(new Error('Audio unlock timeout')), 5000)
    )
  ]).catch((e) => {
    console.warn('[Audio] Audio unlock timed out or failed, continuing anyway:', e)
    audioUnlocked = true // Mark as unlocked to prevent blocking
  })
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
    setCurrentTranslation,
    setCurrentYouMeant,
    currentTranslation,
    selectedTopic,
    selectedRoleplayId,
    customScenario,
    setAudioSilentMode,
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
      // Determine if this is role-play or topic mode
      const isRoleplay = selectedRoleplayId !== null || customScenario !== null
      
      console.log('[API] Starting session:', {
        isRoleplay,
        roleplayId: selectedRoleplayId,
        customScenario: customScenario,
        topic: selectedTopic
      })
      
      // Add timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout
      
      try {
        // Build request body - only include non-null values
        const requestBody: any = {
          user_id: userId,
          target_language: targetLanguage,
          topic: isRoleplay ? 'roleplay' : (selectedTopic || 'random'),
        }
        
        // Only add roleplay fields if they have values
        if (selectedRoleplayId) {
          requestBody.roleplay_id = selectedRoleplayId
        }
        if (customScenario) {
          requestBody.custom_scenario = customScenario
        }
        
        const res = await fetch(`${API_BASE}/session/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        })
        
        clearTimeout(timeoutId)

        if (res.ok) {
          const data = await res.json()
          console.log('[API] Session started:', data.session_id)
          setSessionId(data.session_id)
          setAiMessage(data.greeting)
          return data
        } else {
          const errorText = await res.text()
          console.error('[API] Session start failed:', res.status, errorText)
          throw new Error(`Failed to start session: ${res.status} - ${errorText}`)
        }
      } catch (fetchErr: any) {
        clearTimeout(timeoutId)
        if (fetchErr.name === 'AbortError') {
          console.error('[API] Session start timeout')
          throw new Error('Request timed out. Please try again.')
        }
        throw fetchErr
      }
    } catch (err: any) {
      console.error('[API] Failed to start session:', err)
      throw err
    }
  }, [userId, targetLanguage, selectedTopic, selectedRoleplayId, customScenario, setSessionId, setAiMessage])

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

  // Transcribe audio (auto-detect by default; optional hint for "repeat in target language" step)
  // Two-pass strategy: first try with target language hint, if garbled retry with fallback (English)
  // Now includes intelligent sentence matching and improvement using conversation context
  const transcribeAudio = useCallback(async (
    audioBlob: Blob,
    languageHint?: string | null
  ): Promise<{ text: string; detectedLanguage?: string | null; validForTarget?: boolean; improvement?: any } | null> => {
    try {
      const formData = new FormData()
      // Use a filename that matches the actual mimeType.
      // Whisper accepts webm, mp4, m4a, wav, mp3, etc.
      const ct = (audioBlob?.type || '').toLowerCase()
      const filename =
        ct.includes('audio/mp4') ? 'audio.m4a' :
        ct.includes('audio/m4a') ? 'audio.m4a' :
        ct.includes('audio/wav') ? 'audio.wav' :
        ct.includes('audio/mpeg') ? 'audio.mp3' :
        'audio.webm'
      formData.append('audio', audioBlob, filename)

      // Default fallback to English (most users learning other languages speak English natively)
      const fallbackLang = 'en'
      const hintParam = languageHint ? `&hint=${encodeURIComponent(languageHint)}` : ''
      const fallbackParam = `&fallback_language=${encodeURIComponent(fallbackLang)}`
      const sessionParam = sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ''
      const improveParam = '&improve_sentence=true'
      const res = await fetch(`${API_BASE}/transcribe?language=${targetLanguage}${hintParam}${fallbackParam}${sessionParam}${improveParam}`, {
        method: 'POST',
        body: formData,
      })

      if (res.ok) {
        const data = await res.json()
        // If backend says transcript is not valid for target language, treat as empty.
        const text = data.valid_for_target === false ? '' : data.transcript
        return { 
          text, 
          detectedLanguage: data.detected_language, 
          validForTarget: data.valid_for_target,
          improvement: data.improvement // Includes improved sentence, confidence, etc.
        }
      }
    } catch (err) {
      console.error('Transcription error:', err)
    }
    return null
  }, [targetLanguage, sessionId])

  // Get AI response (streaming)
  const getAiResponse = useCallback(async (transcript: string, detectedLanguage?: string | null): Promise<string | null> => {
    if (!sessionId) return null

    try {
      const res = await fetch(`${API_BASE}/conversation/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          transcript,
          is_partial: false,
          translation_pending: currentTranslation
            ? {
                source: currentTranslation.source,
                translation: currentTranslation.translation,
                alternative: currentTranslation.alternative ?? null,
              }
            : null,
          detected_language: detectedLanguage ?? null,
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
              // Translation assist payload (shown on screen only; NOT spoken automatically)
              if (data.type === 'translation' && data.translation) {
                setCurrentTranslation({
                  source: data.source || '',
                  translation: data.translation,
                  alternative: data.alternative ?? null,
                })
                continue
              }
              if (data.type === 'translation_clear') {
                setCurrentTranslation(null)
                continue
              }
              // Visual-only intent hint (shown on screen only; NOT spoken)
              if (data.type === 'you_meant' && data.text) {
                setCurrentYouMeant(data.text)
                continue
              }
              if (data.type === 'you_meant_clear') {
                setCurrentYouMeant(null)
                continue
              }
              if (data.text) {
                appendAiMessage(data.text)
                fullResponse += data.text
              }
              if (data.done && data.full_response) {
                fullResponse = data.full_response
                // Replace the streamed text with the final canonical response (server may rewrite for language enforcement)
                setAiMessage(fullResponse)
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
  }, [sessionId, appendAiMessage, setCurrentTranslation, setAiMessage, currentTranslation])

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
      
      // On iOS, HTMLAudioElement is more reliable than Web Audio API
      // Use HTMLAudioElement as primary method on native platforms
      if (Capacitor.isNativePlatform()) {
        // Ensure audio is unlocked before playing
        await unlockAudio().catch(err => console.warn('[TTS] Audio unlock warning:', err))
        
        await new Promise<void>((resolve) => {
          const audio = new Audio(audioUrl)
          currentAudio = audio
          audio.playbackRate = playbackRate  // Apply speed control
          audio.setAttribute('playsinline', 'true')
          audio.preload = 'auto'
          audio.volume = 1.0 // Ensure full volume

          let playbackStarted = false

          audio.onended = () => {
            setIsAiSpeaking(false)
            URL.revokeObjectURL(audioUrl)
            currentAudio = null
            console.log('[TTS] Audio playback completed')
            resolve()
          }

          audio.onerror = (e) => {
            console.error('[TTS] Audio error:', e)
            setIsAiSpeaking(false)
            URL.revokeObjectURL(audioUrl)
            currentAudio = null
            resolve()
          }

          // Wait a moment to ensure audio is loaded
          audio.addEventListener('canplaythrough', () => {
            if (!playbackStarted) {
              playbackStarted = true
              audio.play().then(() => {
                console.log('[TTS] Audio playing via HTMLAudioElement')
                setAudioSilentMode(false)
              }).catch((err) => {
                console.error('[TTS] Play failed:', err)
                setAudioSilentMode(true)
                setIsAiSpeaking(false)
                currentAudio = null
                resolve()
              })
            }
          }, { once: true })

          // Fallback: try playing after a short delay even if canplaythrough doesn't fire
          setTimeout(() => {
            if (!playbackStarted) {
              playbackStarted = true
              audio.play().then(() => {
                console.log('[TTS] Audio playing via HTMLAudioElement (delayed)')
                setAudioSilentMode(false)
              }).catch((err) => {
                console.error('[TTS] Play failed (delayed):', err)
                setAudioSilentMode(true)
                setIsAiSpeaking(false)
                currentAudio = null
                resolve()
              })
            }
          }, 200)
        })
      } else {
        // On web, try Web Audio API first, fallback to HTMLAudioElement
        try {
          const ctx = getAudioContext()
          
          if (ctx.state === 'suspended') {
            await ctx.resume()
            console.log('[TTS] AudioContext resumed, state:', ctx.state)
          }
          
          if (ctx.state !== 'running') {
            await new Promise(resolve => setTimeout(resolve, 100))
            if (ctx.state === 'suspended') {
              await ctx.resume()
            }
          }
          
          const arrayBuffer = await audioBlob.arrayBuffer()
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
          
          const source = ctx.createBufferSource()
          source.buffer = audioBuffer
          source.playbackRate.value = playbackRate
          source.connect(ctx.destination)
          
          await new Promise<void>((resolve) => {
            source.onended = () => {
              setIsAiSpeaking(false)
              URL.revokeObjectURL(audioUrl)
              resolve()
            }
            
            try {
              source.start(0)
              console.log(`[TTS] Playing via Web Audio API at ${playbackRate}x speed`)
            } catch (startError) {
              console.error('[TTS] Failed to start audio:', startError)
              setIsAiSpeaking(false)
              URL.revokeObjectURL(audioUrl)
              resolve()
            }
          })
        } catch (webAudioError) {
          console.log('[TTS] Web Audio failed, trying HTMLAudioElement:', webAudioError)
          
          await new Promise<void>((resolve) => {
            const audio = new Audio(audioUrl)
            currentAudio = audio
            audio.playbackRate = playbackRate
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

            audio.play().then(() => {
              setAudioSilentMode(false)
            }).catch((err) => {
              console.error('[TTS] Play failed:', err)
              setAudioSilentMode(true)
              setIsAiSpeaking(false)
              currentAudio = null
              resolve()
            })
          })
        }
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
