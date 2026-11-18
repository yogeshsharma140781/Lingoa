// Microphone permission for the conversation screen. The logic is the same as the
// original conversation screen's: iOS can only be asked (never queried), the web can do both.

import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useStore } from '../store'

export type MicPermissionState = 'checking' | 'prompt' | 'requesting' | 'granted' | 'denied'

const isNativeIos = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

export function useMicPermission() {
  const setMicPermission = useStore((s) => s.setMicPermission)
  const { logEvent } = useApi()
  const [state, setState] = useState<MicPermissionState>('checking')

  useEffect(() => {
    const check = async () => {
      try {
        // iOS cannot report the permission without asking: leave it at "prompt".
        if (isNativeIos()) {
          setState('prompt')
          return
        }
        if (navigator.permissions?.query) {
          const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })
          if (result.state === 'granted') {
            setState('granted')
            setMicPermission('granted')
            return
          }
          if (result.state === 'denied') {
            setMicPermission('denied')
          }
        }
        setState('prompt')
      } catch {
        setState('prompt')
      }
    }
    check()
  }, [setMicPermission])

  const request = useCallback(async () => {
    setState('requesting')
    try {
      const constraints: MediaStreamConstraints = isNativeIos()
        ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
        : { audio: true }
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        new Promise<MediaStream>((_, reject) => setTimeout(() => reject(new Error('getUserMedia timeout')), 10000)),
      ])
      stream.getTracks().forEach((t) => t.stop())
      setState('granted')
      setMicPermission('granted')
      logEvent('mic_permission_granted')
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setState('denied')
        setMicPermission('denied')
        logEvent('mic_permission_denied')
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        alert('No microphone found. Please test on a real device or ensure your microphone is connected.')
        setState('prompt')
        setMicPermission('denied')
      } else {
        // A timeout or something unexpected: let them try again.
        setState('prompt')
      }
    }
  }, [setMicPermission, logEvent])

  const openSettings = useCallback(() => {
    if (!isNativeIos()) return
    // iOS deep link to this app's page in Settings.
    window.location.href = 'app-settings:'
  }, [])

  return { state, request, openSettings, isNativeIos: isNativeIos() }
}
