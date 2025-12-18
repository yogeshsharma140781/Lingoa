import { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useStore } from './store'
import { useApi } from './hooks/useApi'
import { HomeScreen } from './components/HomeScreen'
import { TopicSelectionScreen } from './components/TopicSelectionScreen'
import { ConversationScreen } from './components/ConversationScreen'
import { CompletionScreen } from './components/CompletionScreen'
import { ImprovementsScreen } from './components/ImprovementsScreen'

export default function App() {
  const { currentScreen } = useStore()
  const { fetchUserStats } = useApi()

  useEffect(() => {
    fetchUserStats()
  }, [fetchUserStats])

  return (
    <div className="h-full w-full animated-gradient overflow-hidden relative">
      {/* Decorative background shapes */}
      <div className="floating-shape w-96 h-96 bg-primary-500 top-[-10%] left-[-10%] animate-float" />
      <div className="floating-shape w-80 h-80 bg-accent-500 bottom-[-15%] right-[-10%] animate-float" style={{ animationDelay: '-3s' }} />
      <div className="floating-shape w-64 h-64 bg-primary-600 top-[40%] right-[-20%] animate-float" style={{ animationDelay: '-6s' }} />
      
      {/* Main content */}
      <AnimatePresence mode="wait">
        {currentScreen === 'home' && <HomeScreen key="home" />}
        {currentScreen === 'topics' && <TopicSelectionScreen key="topics" />}
        {currentScreen === 'conversation' && <ConversationScreen key="conversation" />}
        {currentScreen === 'completion' && <CompletionScreen key="completion" />}
        {currentScreen === 'improvements' && <ImprovementsScreen key="improvements" />}
      </AnimatePresence>
    </div>
  )
}

