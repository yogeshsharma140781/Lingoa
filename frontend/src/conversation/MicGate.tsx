// The screens that come before the conversation: asking for the microphone, being refused,
// starting up, and a failed start. White, like the rest of the app.

import { Loader2, Mic, MicOff } from 'lucide-react'
import type { MicPermissionState } from './useMicPermission'
import { DotRing } from './ui/DotRing'

interface MicGateProps {
  permission: MicPermissionState
  isNativeIos: boolean
  startError: string | null
  onRequest: () => void
  onOpenSettings: () => void
  onRetryStart: () => void
  onGoBack: () => void
}

export function MicGate({ permission, isNativeIos, startError, onRequest, onOpenSettings, onRetryStart, onGoBack }: MicGateProps) {
  if (permission === 'checking') {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 text-[#555555] animate-spin" />
      </div>
    )
  }

  if (permission === 'prompt' || permission === 'requesting') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 relative z-10 bg-white text-[#111111]">
        <div className="relative w-32 h-32 mb-8">
          <svg viewBox="0 0 120 120" className="absolute inset-0" aria-hidden="true">
            <DotRing color="#c4c4c4" />
          </svg>
          <div className="absolute inset-[10px] rounded-full bg-[#f3f3f3] flex items-center justify-center">
            <Mic className="w-12 h-12 text-[#262626]" strokeWidth={1.5} />
          </div>
        </div>
        <div className="text-center mb-8">
          <h2 className="font-display text-3xl font-semibold mb-4 tracking-tight">Microphone access needed</h2>
          <p className="lt-muted text-lg max-w-xs mx-auto leading-snug">
            Lingoa needs microphone access to record your voice for language practice conversations. Your audio is only used during the conversation and is not stored permanently.
          </p>
        </div>
        <div className="w-full max-w-xs">
          <button
            onClick={onRequest}
            disabled={permission === 'requesting'}
            className="lt-primary"
          >
            {permission === 'requesting' ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Requesting Access...
              </>
            ) : (
              <>
                <Mic className="w-5 h-5" />
                Continue
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  if (permission === 'denied') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 relative z-10 bg-white text-[#111111]">
        <div className="w-24 h-24 rounded-full bg-[#f3f3f3] flex items-center justify-center mb-6">
          <MicOff className="w-10 h-10 text-[#262626]" strokeWidth={1.5} />
        </div>
        <h2 className="font-display text-2xl font-semibold mb-3">Microphone access needed</h2>
        <p className="lt-muted text-center mb-8 max-w-xs">
          {isNativeIos
            ? 'Microphone access is turned off for Lingoa. Enable it in iPhone Settings to continue.'
            : 'Please allow microphone access to use speaking practice.'}
        </p>
        <div className="space-y-3 w-full max-w-xs">
          <button
            onClick={isNativeIos ? onOpenSettings : onRequest}
            className="lt-primary"
          >
            <Mic className="w-5 h-5" />
            {isNativeIos ? 'Open Settings' : 'Enable Microphone'}
          </button>
          <button onClick={onGoBack} className="lt-secondary">
            Go Back
          </button>
        </div>
      </div>
    )
  }

  // Permission granted, but the conversation has not started yet.
  if (startError) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 bg-white text-[#111111]">
        <div className="text-center max-w-xs">
          <h2 className="font-display text-2xl font-semibold mb-3">Something went wrong</h2>
          <p className="lt-muted mb-6">{startError}</p>
          <div className="space-y-3">
            <button onClick={onRetryStart} className="lt-primary">
              Try Again
            </button>
            <button onClick={onGoBack} className="lt-secondary">
              Go Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex items-center justify-center bg-white text-[#111111]">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-[#555555] animate-spin mx-auto mb-4" />
        <p className="lt-muted">Starting conversation...</p>
      </div>
    </div>
  )
}
