// The screens that come before the conversation: asking for the microphone, being refused,
// starting up, and a failed start. They keep the app's dark look; the white conversation
// screen only begins once the AI is ready to speak.

import { Loader2, Mic, MicOff } from 'lucide-react'
import type { MicPermissionState } from './useMicPermission'

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
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-400 animate-spin" />
      </div>
    )
  }

  if (permission === 'prompt' || permission === 'requesting') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 relative z-10 text-white">
        <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center glow-primary mb-8">
          <Mic className="w-16 h-16 text-white" />
        </div>
        <div className="text-center mb-8">
          <h2 className="font-display text-3xl font-bold mb-4">Microphone Access Required</h2>
          <p className="text-surface-400 text-lg max-w-xs mx-auto">
            Lingoa needs microphone access to record your voice for language practice conversations. Your audio is only used during the conversation and is not stored permanently.
          </p>
        </div>
        <div className="w-full max-w-xs">
          <button
            onClick={onRequest}
            disabled={permission === 'requesting'}
            className="w-full btn-primary rounded-2xl py-4 flex items-center justify-center gap-3 font-semibold text-lg text-white disabled:opacity-50"
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
      <div className="h-full flex flex-col items-center justify-center p-6 relative z-10 text-white">
        <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center mb-6">
          <MicOff className="w-12 h-12 text-red-400" />
        </div>
        <h2 className="text-2xl font-semibold mb-3">Microphone Access Required</h2>
        <p className="text-surface-400 text-center mb-8 max-w-xs">
          {isNativeIos
            ? 'Microphone access is turned off for Lingoa. Enable it in iPhone Settings to continue.'
            : 'Please allow microphone access to use speaking practice.'}
        </p>
        <div className="space-y-3 w-full max-w-xs">
          <button
            onClick={isNativeIos ? onOpenSettings : onRequest}
            className="w-full btn-primary rounded-2xl py-4 font-semibold text-white flex items-center justify-center gap-2"
          >
            <Mic className="w-5 h-5" />
            {isNativeIos ? 'Open Settings' : 'Enable Microphone'}
          </button>
          <button onClick={onGoBack} className="w-full glass rounded-2xl py-3 font-medium text-surface-400 hover:bg-white/10 transition-colors">
            Go Back
          </button>
        </div>
      </div>
    )
  }

  // Permission granted, but the conversation has not started yet.
  if (startError) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-white">
        <div className="text-center max-w-xs">
          <h2 className="text-2xl font-semibold mb-3 text-red-400">Error</h2>
          <p className="text-surface-400 mb-6">{startError}</p>
          <div className="space-y-3">
            <button onClick={onRetryStart} className="w-full btn-primary rounded-2xl py-3 font-semibold text-white">
              Try Again
            </button>
            <button onClick={onGoBack} className="w-full glass rounded-2xl py-3 font-medium text-surface-400 hover:bg-white/10 transition-colors">
              Go Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex items-center justify-center text-white">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-primary-400 animate-spin mx-auto mb-4" />
        <p className="text-surface-400">Starting conversation...</p>
      </div>
    </div>
  )
}
