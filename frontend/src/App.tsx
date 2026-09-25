import { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Capacitor } from '@capacitor/core'
import { useStore } from './store'
import { useApi } from './hooks/useApi'
import { App as CapacitorApp } from '@capacitor/app'
import { listenForNotificationTaps, syncReminders } from './hooks/useNotifications'
import { HomeScreen } from './components/HomeScreen'
import { ModeSelectionScreen } from './components/ModeSelectionScreen'
import { TopicSelectionScreen } from './components/TopicSelectionScreen'
import { RoleplaySelectionScreen } from './components/RoleplaySelectionScreen'
import { CustomRoleplayScreen } from './components/CustomRoleplayScreen'
import { ConversationScreen } from './components/ConversationScreen'
import { CompletionScreen } from './components/CompletionScreen'
import { ImprovementsScreen } from './components/ImprovementsScreen'

export default function App() {
  const { currentScreen, completedToday, streak, targetLanguage, targetTime } = useStore()
  const { fetchUserStats, logEvent } = useApi()

  useEffect(() => {
    fetchUserStats()
  }, [fetchUserStats])

  // Keep the pending reminders (the next week of evenings) in sync with the
  // latest known stats. Re-runs whenever these change for any reason.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    syncReminders({
      streak,
      completedToday,
      targetLanguage,
      targetMinutes: Math.round(targetTime / 60000),
    })
  }, [completedToday, streak, targetLanguage, targetTime])

  // iOS keeps the app alive in the background, so a cold start isn't the only
  // way back in. On resume, re-fetch stats (the day may have rolled over) and
  // re-sync explicitly, since unchanged stats wouldn't re-trigger the effect
  // above - and the window of scheduled evenings needs topping up regardless.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const handlePromise = CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive) return
      await fetchUserStats()
      const s = useStore.getState()
      syncReminders({
        streak: s.streak,
        completedToday: s.completedToday,
        targetLanguage: s.targetLanguage,
        targetMinutes: Math.round(s.targetTime / 60000),
      })
    })
    return () => {
      handlePromise.then((handle) => handle.remove()).catch(() => {})
    }
  }, [fetchUserStats])

  // Register the notification-tap listener once. This is the one reliable
  // signal that a reminder actually brought someone back into the app.
  useEffect(() => {
    return listenForNotificationTaps(() => logEvent('notification_tapped'))
  }, [logEvent])

  return (
    <div className="h-full w-full animated-gradient overflow-hidden relative">
      {/* Decorative background shapes */}
      <div className="floating-shape w-96 h-96 bg-primary-500 top-[-10%] left-[-10%] animate-float" />
      <div className="floating-shape w-80 h-80 bg-accent-500 bottom-[-15%] right-[-10%] animate-float" style={{ animationDelay: '-3s' }} />
      <div className="floating-shape w-64 h-64 bg-primary-600 top-[40%] right-[-20%] animate-float" style={{ animationDelay: '-6s' }} />
      
      {/* Main content */}
      <AnimatePresence mode="wait">
        {currentScreen === 'home' && <HomeScreen key="home" />}
        {currentScreen === 'mode' && <ModeSelectionScreen key="mode" />}
        {currentScreen === 'topics' && <TopicSelectionScreen key="topics" />}
        {currentScreen === 'roleplay' && <RoleplaySelectionScreen key="roleplay" />}
        {currentScreen === 'custom-roleplay' && <CustomRoleplayScreen key="custom-roleplay" />}
        {currentScreen === 'conversation' && <ConversationScreen key="conversation" />}
        {currentScreen === 'completion' && <CompletionScreen key="completion" />}
        {currentScreen === 'improvements' && <ImprovementsScreen key="improvements" />}
      </AnimatePresence>
    </div>
  )
}

