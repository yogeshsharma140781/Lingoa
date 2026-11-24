// Shared types for the conversation screen. No UI code.

export type EvaluationLevel = 'excellent' | 'good' | 'almost' | 'retry'

/** Structured result of judging what the learner said. */
export interface Evaluation {
  transcript: string
  level: EvaluationLevel
  /** Reaction label in the target language (e.g. "Goed gedaan!"). */
  reaction: string
  /** A natural alternative, a minimal edit of the learner's own sentence. Null if none is needed. */
  alternative: string | null
  /** Words in `alternative` that changed (shown in bold). */
  changedWords: string[]
}

/** Two hints shown after "Show a hint". */
export interface Hints {
  /** A natural answer to the AI's line. */
  answer: string
  /** A stalling phrase in the target language ("I need a moment"). */
  stall: string
}

/** What the AI just said. */
export interface AiLine {
  /** Target-language text. */
  text: string
  /** English translation (hidden until the learner taps Translate). */
  translation: string
}

export type ConversationStateName =
  | 'aiSpeaking'
  | 'userListening'
  | 'userSpeaking'
  | 'userWaiting'
  | 'hintShown'
  | 'resting'
  | 'processing'
  | 'feedback'
  | 'wrapOffer'
