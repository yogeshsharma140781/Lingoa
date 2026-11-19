// Microphone permission for the conversation screen.
//
// The explanation screen ("Microphone access needed") is for the FIRST time only. After the
// user has allowed the microphone once, later sessions go straight to the conversation. The
// screen comes back only when the permission is off (for example switched off in iPhone Settings).
//
// iOS cannot be asked "is the microphone allowed?" without prompting, so:
//  1. If the Permissions API can answer, believe it.
//  2. Otherwise, if we remember an earlier grant, check by opening the microphone for a moment.
//     That never shows a prompt when the permission was already given, and fails straight away
//     (no prompt) when it was turned off.
//  3. Otherwise this is the first time: show the explanation screen.

import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useStore } from '../store'

export type MicPermissionState = 'checking' | 'prompt' | 'requesting' | 'granted' | 'denied'

const GRANTED_FLAG = 'lingoa_mic_granted'
const isNativeIos = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

const rememberGranted = (on: boolean) => {
  try {
    if (on) localStorage.setItem(GRANTED_FLAG, '1')
    else localStorage.removeItem(GRANTED_FLAG)
  } catch {
    // storage unavailable: the explanation screen simply shows again next time
  }
}
const hasRememberedGrant = () => {
  try {
    return localStorage.getItem(GRANTED_FLAG) === '1'
  } catch {
    return false
  }
}

/** Open the microphone for a moment. 'granted', 'denied' (turned off), or 'error' (something else). */
async function probeMicrophone(): Promise<'granted' | 'denied' | 'error'> {
  try {
    const stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: true }),
      new Promise<MediaStream>((_, reject) => setTimeout(() => reject(new Error('getUserMedia timeout')), 8000)),
    ])
    stream.getTracks().forEach((t) => t.stop())
    return 'granted'
  } catch (err: any) {
    return err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError' ? 'denied' : 'error'
  }
}

export function useMicPermission() {
  const setMicPermission = useStore((s) => s.setMicPermission)
  const { logEvent } = useApi()
  const [state, setState] = useState<MicPermissionState>('checking')

  const markGranted = useCallback(() => {
    rememberGranted(true)
    setState('granted')
    setMicPermission('granted')
  }, [setMicPermission])

  const markDenied = useCallback(() => {
    rememberGranted(false) // so that allowing it again later starts from a clean state
    setState('denied')
    setMicPermission('denied')
  }, [setMicPermission])

  // First thing: work out whether to ask at all.
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      // 1. The Permissions API, where it exists and can answer.
      try {
        if (navigator.permissions?.query) {
          const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })
          if (cancelled) return
          if (result.state === 'granted') return markGranted()
          if (result.state === 'denied') {
            // In a plain browser they can still be asked again; on the phone it means "off in Settings".
            if (isNativeIos()) return markDenied()
            setMicPermission('denied')
            return setState('prompt')
          }
        }
      } catch {
        // not supported: fall through
      }
      // 2. We remember that they allowed it before: check quietly.
      if (hasRememberedGrant()) {
        const result = await probeMicrophone()
        if (cancelled) return
        if (result === 'granted') return markGranted()
        if (result === 'denied') return markDenied()
        // an unexpected error (not a refusal): let them continue; starting the mic will report it
        return markGranted()
      }
      // 3. First time.
      setState('prompt')
    }
    check()
    return () => {
      cancelled = true
    }
  }, [markGranted, markDenied, setMicPermission])

  // Switched on again in iPhone Settings: pick it up when they come back, without asking again.
  useEffect(() => {
    if (state !== 'denied') return
    const recheck = async () => {
      if (document.visibilityState !== 'visible') return
      if ((await probeMicrophone()) === 'granted') markGranted()
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
    return () => {
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
    }
  }, [state, markGranted])

  /** The first-time "Continue" button: this is what makes iOS show its own permission dialog. */
  const request = useCallback(async () => {
    setState('requesting')
    try {
      const constraints: MediaStreamConstraints = isNativeIos()
        ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
        : { audio: true }
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        // Long enough to read and answer the system dialog.
        new Promise<MediaStream>((_, reject) => setTimeout(() => reject(new Error('getUserMedia timeout')), 60000)),
      ])
      stream.getTracks().forEach((t) => t.stop())
      markGranted()
      logEvent('mic_permission_granted')
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        markDenied()
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
  }, [markGranted, markDenied, setMicPermission, logEvent])

  const openSettings = useCallback(() => {
    if (!isNativeIos()) return
    // iOS deep link to this app's page in Settings.
    window.location.href = 'app-settings:'
  }, [])

  return { state, request, openSettings, isNativeIos: isNativeIos() }
}
