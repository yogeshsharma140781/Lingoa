// The conversation screen's state machine: a pure type, no UI and no timers,
// so it can be unit tested. Timers live in turnTaking.ts; this file only says
// which state follows which event, and what each state looks like.

import type { ConversationStateName, EvaluationLevel } from './types'

export type ConversationState =
  | { name: 'aiSpeaking' }
  | { name: 'userListening' }
  | { name: 'userSpeaking' }
  | { name: 'userWaiting' }
  | { name: 'hintShown' }
  | { name: 'resting' }
  | { name: 'processing' }
  | { name: 'feedback'; level: EvaluationLevel }

export type ConversationEvent =
  | { type: 'AI_AUDIO_STARTED' }
  | { type: 'AI_AUDIO_ENDED' }
  | { type: 'SPEECH_STARTED' }
  /** What sounded like speech turned out to be steady background noise. */
  | { type: 'SPEECH_CANCELLED' }
  | { type: 'WAITING_TIMEOUT' }
  | { type: 'SHOW_HINT' }
  | { type: 'RESTING_TIMEOUT' }
  | { type: 'TAP_AVATAR' }
  | { type: 'TURN_ENDED' }
  /** Nothing usable was heard (silence or noise): quietly listen again. */
  | { type: 'TURN_DISCARDED' }
  | { type: 'EVALUATION_READY'; level: EvaluationLevel }
  | { type: 'CONTINUE' }
  | { type: 'TRY_AGAIN' }
  | { type: 'SKIP' }

export const initialState: ConversationState = { name: 'aiSpeaking' }

/**
 * The next state for an event. Events that make no sense in the current state are
 * ignored (the same state object comes back), so late or duplicate events are harmless.
 */
export function transition(state: ConversationState, event: ConversationEvent): ConversationState {
  switch (state.name) {
    case 'aiSpeaking':
      if (event.type === 'AI_AUDIO_ENDED') return { name: 'userListening' }
      return state

    case 'userListening':
      if (event.type === 'SPEECH_STARTED') return { name: 'userSpeaking' }
      if (event.type === 'WAITING_TIMEOUT') return { name: 'userWaiting' }
      if (event.type === 'AI_AUDIO_STARTED') return { name: 'aiSpeaking' } // Replay
      return state

    case 'userSpeaking':
      if (event.type === 'TURN_ENDED') return { name: 'processing' }
      if (event.type === 'SPEECH_CANCELLED') return { name: 'userListening' }
      return state

    case 'userWaiting':
      if (event.type === 'SPEECH_STARTED') return { name: 'userSpeaking' }
      if (event.type === 'SHOW_HINT') return { name: 'hintShown' }
      if (event.type === 'RESTING_TIMEOUT') return { name: 'resting' }
      if (event.type === 'AI_AUDIO_STARTED') return { name: 'aiSpeaking' } // Replay
      return state

    case 'hintShown':
      if (event.type === 'SPEECH_STARTED') return { name: 'userSpeaking' }
      if (event.type === 'RESTING_TIMEOUT') return { name: 'resting' }
      if (event.type === 'AI_AUDIO_STARTED') return { name: 'aiSpeaking' } // Replay
      return state

    case 'resting':
      if (event.type === 'TAP_AVATAR') return { name: 'userListening' }
      return state

    case 'processing':
      if (event.type === 'EVALUATION_READY') return { name: 'feedback', level: event.level }
      if (event.type === 'TURN_DISCARDED') return { name: 'userListening' }
      return state

    case 'feedback':
      if (event.type === 'CONTINUE' && state.level !== 'retry') return { name: 'aiSpeaking' }
      if (event.type === 'TRY_AGAIN' && state.level === 'retry') return { name: 'userListening' }
      if (event.type === 'SKIP' && state.level === 'retry') return { name: 'aiSpeaking' }
      return state
  }
}

/** What a state looks like. The UI renders this and nothing else about the state. */
export interface StateView {
  /** Avatar ring: solid while the AI speaks, dashed otherwise. */
  ring: 'solid' | 'dashed'
  /** Whether the microphone is open. */
  micOpen: boolean
  /** The AI's line is dimmed (only in feedback, where the learner's words take over). */
  aiLineDimmed: boolean
  /** Replay and Translate sit under the AI line (always, so nothing jumps). */
  showAiActions: boolean
  /** Under the avatar: 'Speaking…', 'Listening…', 'Tap to continue', 'One moment…'. Feedback uses the reaction instead. */
  avatarLabel: string | null
  /** The area below the buttons: a waveform, a line of dots, or nothing. */
  indicator: 'none' | 'waveform' | 'dots' | 'processing'
  /** Caption under the indicator. */
  indicatorCaption: string | null
  showHintButton: boolean
  showHintCard: boolean
  /** 'YOU SAID' block (feedback only). */
  showTranscript: boolean
  showContinue: boolean
  /** 'Try again' and 'Skip' (feedback with level 'retry'). */
  showRetry: boolean
  /** Tapping the avatar does something (resting). */
  avatarTappable: boolean
  /** A screen-reader announcement for entering this state. */
  announcement: string
}

const BASE: StateView = {
  ring: 'dashed',
  micOpen: false,
  aiLineDimmed: false,
  showAiActions: true,
  avatarLabel: null,
  indicator: 'none',
  indicatorCaption: null,
  showHintButton: false,
  showHintCard: false,
  showTranscript: false,
  showContinue: false,
  showRetry: false,
  avatarTappable: false,
  announcement: '',
}

export function describeState(state: ConversationState): StateView {
  switch (state.name) {
    case 'aiSpeaking':
      return { ...BASE, ring: 'solid', avatarLabel: 'Speaking…', announcement: 'Speaking' }
    case 'userListening':
    case 'userSpeaking':
      return {
        ...BASE,
        micOpen: true,
        avatarLabel: 'Listening…',
        indicator: 'waveform',
        indicatorCaption: 'Say something…',
        announcement: 'Listening',
      }
    case 'userWaiting':
      return {
        ...BASE,
        micOpen: true,
        avatarLabel: 'Listening…',
        indicator: 'dots',
        indicatorCaption: 'Take your time…',
        showHintButton: true,
        announcement: 'Take your time',
      }
    case 'hintShown':
      return {
        ...BASE,
        micOpen: true,
        avatarLabel: 'Listening…',
        indicator: 'dots',
        indicatorCaption: 'Take your time…',
        showHintCard: true,
        announcement: 'Here are two things you could say',
      }
    case 'resting':
      return { ...BASE, avatarLabel: 'Tap to continue', avatarTappable: true, announcement: 'Paused. Tap to continue' }
    case 'processing':
      return {
        ...BASE,
        avatarLabel: null,
        indicator: 'processing',
        indicatorCaption: 'One moment…',
        announcement: 'One moment',
      }
    case 'feedback':
      return {
        ...BASE,
        aiLineDimmed: true,
        showTranscript: true,
        showContinue: state.level !== 'retry',
        showRetry: state.level === 'retry',
        announcement: 'Feedback',
      }
  }
}

export const STATE_NAMES: ConversationStateName[] = [
  'aiSpeaking',
  'userListening',
  'userSpeaking',
  'userWaiting',
  'hintShown',
  'resting',
  'processing',
  'feedback',
]
