import { create } from 'zustand'

export type Screen = 'home' | 'topics' | 'conversation' | 'completion' | 'improvements'

// Topic definitions
export interface Topic {
  id: string
  name: string
  emoji: string
  nameHi?: string  // Hindi name for display
}

export const TOPICS: Topic[] = [
  { id: 'daily', name: 'Daily Life', emoji: '☀️', nameHi: 'रोज़मर्रा' },
  { id: 'food', name: 'Food', emoji: '🍜', nameHi: 'खाना' },
  { id: 'work', name: 'Work / School', emoji: '💼', nameHi: 'काम' },
  { id: 'family', name: 'Family & Friends', emoji: '👨‍👩‍👧', nameHi: 'परिवार' },
  { id: 'travel', name: 'Travel', emoji: '✈️', nameHi: 'यात्रा' },
  { id: 'hobbies', name: 'Hobbies', emoji: '🎮', nameHi: 'शौक' },
  { id: 'weekend', name: 'Weekend Plans', emoji: '🎉', nameHi: 'वीकेंड' },
  { id: 'random', name: 'Surprise Me', emoji: '🎲', nameHi: 'कुछ भी' },
]

export type Language = {
  code: string
  name: string
  flag: string
}

export const LANGUAGES: Language[] = [
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', flag: '🇧🇷' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
]

export interface Improvement {
  original: string
  better: string
  context?: string
}

export interface Correction {
  original: string        // What the user said (in target language)
  corrected: string       // Correct way to say it (in target language)
  explanation: string     // Explanation in English
  audioUrl?: string       // Audio URL for playback
}

interface AppState {
  // Navigation
  currentScreen: Screen
  setScreen: (screen: Screen) => void

  // User
  userId: string
  streak: number
  completedToday: boolean
  setUserStats: (streak: number, completedToday: boolean) => void

  // Session
  sessionId: string | null
  targetLanguage: string
  setTargetLanguage: (lang: string) => void
  setSessionId: (id: string | null) => void
  
  // Topic
  selectedTopic: string | null  // Topic ID
  lastTopic: string | null      // For avoiding repetition
  setSelectedTopic: (topicId: string | null) => void

  // Timer
  speakingTime: number // in milliseconds
  targetTime: number // 5 minutes in ms
  incrementSpeakingTime: (ms: number) => void
  resetSpeakingTime: () => void

  // Audio
  isSpeaking: boolean
  setIsSpeaking: (speaking: boolean) => void
  isAiSpeaking: boolean
  setIsAiSpeaking: (speaking: boolean) => void
  audioSpeed: number
  setAudioSpeed: (speed: number) => void

  // Conversation
  aiMessage: string
  setAiMessage: (msg: string) => void
  appendAiMessage: (chunk: string) => void
  clearAiMessage: () => void
  userTranscript: string
  setUserTranscript: (text: string) => void
  isProcessing: boolean
  setIsProcessing: (processing: boolean) => void

  // Feedback
  improvements: Improvement[]
  setImprovements: (improvements: Improvement[]) => void
  
  // Real-time corrections
  currentCorrection: Correction | null
  setCurrentCorrection: (correction: Correction | null) => void

  // Microphone
  micPermission: 'prompt' | 'granted' | 'denied'
  setMicPermission: (status: 'prompt' | 'granted' | 'denied') => void

  // Reset
  resetSession: () => void
}

// Generate a simple user ID
const generateUserId = () => {
  const stored = localStorage.getItem('lingoa_user_id')
  if (stored) return stored
  const id = 'user_' + Math.random().toString(36).substring(2, 15)
  localStorage.setItem('lingoa_user_id', id)
  return id
}

export const useStore = create<AppState>((set) => ({
  // Navigation
  currentScreen: 'home',
  setScreen: (screen) => set({ currentScreen: screen }),

  // User
  userId: generateUserId(),
  streak: 0,
  completedToday: false,
  setUserStats: (streak, completedToday) => set({ streak, completedToday }),

  // Session
  sessionId: null,
  targetLanguage: localStorage.getItem('lingoa_language') || 'es',
  setTargetLanguage: (lang) => {
    localStorage.setItem('lingoa_language', lang)
    set({ targetLanguage: lang })
  },
  setSessionId: (id) => set({ sessionId: id }),
  
  // Topic
  selectedTopic: null,
  lastTopic: localStorage.getItem('lingoa_last_topic'),
  setSelectedTopic: (topicId) => {
    if (topicId) {
      localStorage.setItem('lingoa_last_topic', topicId)
    }
    set((state) => ({ 
      selectedTopic: topicId,
      lastTopic: topicId || state.lastTopic 
    }))
  },

  // Timer
  speakingTime: 0,
  targetTime: 5 * 60 * 1000, // 5 minutes
  incrementSpeakingTime: (ms) => set((state) => ({
    speakingTime: Math.min(state.speakingTime + ms, state.targetTime)
  })),
  resetSpeakingTime: () => set({ speakingTime: 0 }),

  // Audio
  isSpeaking: false,
  setIsSpeaking: (speaking) => set({ isSpeaking: speaking }),
  isAiSpeaking: false,
  setIsAiSpeaking: (speaking) => set({ isAiSpeaking: speaking }),
  audioSpeed: parseFloat(localStorage.getItem('lingoa_speed') || '1.0'),
  setAudioSpeed: (speed) => {
    localStorage.setItem('lingoa_speed', speed.toString())
    set({ audioSpeed: speed })
  },

  // Conversation
  aiMessage: '',
  setAiMessage: (msg) => set({ aiMessage: msg }),
  appendAiMessage: (chunk) => set((state) => ({
    aiMessage: state.aiMessage + chunk
  })),
  clearAiMessage: () => set({ aiMessage: '' }),
  userTranscript: '',
  setUserTranscript: (text) => set({ userTranscript: text }),
  isProcessing: false,
  setIsProcessing: (processing) => set({ isProcessing: processing }),

  // Feedback
  improvements: [],
  setImprovements: (improvements) => set({ improvements }),
  
  // Real-time corrections
  currentCorrection: null,
  setCurrentCorrection: (correction) => set({ currentCorrection: correction }),

  // Microphone
  micPermission: 'prompt',
  setMicPermission: (status) => set({ micPermission: status }),

  // Reset
  resetSession: () => set({
    sessionId: null,
    speakingTime: 0,
    isSpeaking: false,
    isAiSpeaking: false,
    aiMessage: '',
    userTranscript: '',
    isProcessing: false,
    improvements: [],
    currentCorrection: null,
    selectedTopic: null,
  }),
}))

