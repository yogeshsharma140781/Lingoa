// Patient turn-taking: decides when to say "take your time", when to rest, and
// when the learner has really finished. A pure class with no timers of its own:
// the caller feeds it the clock (`now`, in seconds) and the voice detector's
// output, so tests can drive it with a fake clock.

import {
  SENTENCE_FINAL,
  TRAILING_OFF,
  UNFINISHED_ENDINGS,
  type TurnConfig,
} from './config'

const NO_SPACE_LANGUAGES = new Set(['zh', 'ja', 'ko'])

/**
 * Does a (partial) transcript look like a finished sentence?
 * - true: ends with sentence-final punctuation or a content word
 * - false: trails off (ellipsis, comma, dash) or ends with a conjunction, article, preposition or filler
 * - null: nothing to judge (empty)
 */
export function looksFinished(
  transcript: string | null | undefined,
  language: string,
  unfinished: Record<string, string[]> = UNFINISHED_ENDINGS,
): boolean | null {
  const text = (transcript ?? '').trim()
  if (!text) return null
  if (TRAILING_OFF.test(text)) return false
  if (SENTENCE_FINAL.test(text)) return true

  const endings = unfinished[language] ?? unfinished.en ?? []
  const lower = text.toLowerCase()
  if (NO_SPACE_LANGUAGES.has(language)) {
    return !endings.some((token) => lower.endsWith(token))
  }
  const lastWord = lower.split(/\s+/).pop()!.replace(/[^\p{L}\p{N}'’-]+/gu, '')
  return !endings.includes(lastWord)
}

export type TurnAction =
  | { type: 'SPEECH_STARTED' }
  | { type: 'WAITING_TIMEOUT' }
  | { type: 'RESTING_TIMEOUT' }
  | { type: 'TURN_ENDED'; reason: 'silence' | 'maxDuration' }

export interface TurnSnapshot {
  speechStarted: boolean
  /** Seconds since the mic opened. */
  sinceMicOpen: number
  /** Seconds since the last voiced moment (null before any speech). */
  silence: number | null
  /** The silence (seconds) that would end the turn right now, given the partial transcript. */
  endThreshold: number | null
}

export class TurnTaker {
  private micOpenedAt = 0
  private active = false

  // Voice-run tracking (to ignore blips shorter than minSpeechDuration).
  private voicedSince: number | null = null
  private lastVoicedAt: number | null = null

  private speechStarted = false
  private speechStartedAt = 0
  private waitingEmitted = false
  private restingEmitted = false
  private ended = false

  private partial: string | null = null

  constructor(
    private readonly config: TurnConfig,
    private readonly language: string,
    private readonly unfinished: Record<string, string[]> = UNFINISHED_ENDINGS,
  ) {}

  /** The mic just opened (or reopened): start a fresh turn. */
  open(now: number): void {
    this.micOpenedAt = now
    this.active = true
    this.voicedSince = null
    this.lastVoicedAt = null
    this.speechStarted = false
    this.speechStartedAt = 0
    this.waitingEmitted = false
    this.restingEmitted = false
    this.ended = false
    this.partial = null
  }

  /** The mic closed (AI speaking, hint playing, processing): stop deciding anything. */
  close(): void {
    this.active = false
    this.voicedSince = null
  }

  /** The latest partial transcript of this turn, if any (null clears it). */
  setPartialTranscript(text: string | null): void {
    this.partial = text
  }

  /**
   * Report whether the voice detector hears voice right now. Call on every audio frame
   * (or at least on every change) and then call tick().
   */
  voice(now: number, voiced: boolean): void {
    if (!this.active || this.ended) return
    if (voiced) {
      if (this.voicedSince === null) this.voicedSince = now
      this.lastVoicedAt = now
    } else {
      this.voicedSince = null
    }
  }

  /** Advance the clock and get whatever the machine should hear about. */
  tick(now: number): TurnAction[] {
    if (!this.active || this.ended) return []
    const actions: TurnAction[] = []

    // A voiced run only counts as speech once it lasts minSpeechDuration.
    if (this.voicedSince !== null && now - this.voicedSince >= this.config.minSpeechDuration) {
      if (!this.speechStarted) {
        this.speechStarted = true
        this.speechStartedAt = this.voicedSince
        actions.push({ type: 'SPEECH_STARTED' })
      }
    }

    if (!this.speechStarted) {
      // Never submit silence: only escalate to "take your time", then to resting.
      const elapsed = now - this.micOpenedAt
      if (!this.restingEmitted && elapsed >= this.config.restingDelay) {
        this.restingEmitted = true
        this.waitingEmitted = true
        this.active = false // the mic closes in resting
        actions.push({ type: 'RESTING_TIMEOUT' })
      } else if (!this.waitingEmitted && elapsed >= this.config.waitingDelay) {
        this.waitingEmitted = true
        actions.push({ type: 'WAITING_TIMEOUT' })
      }
      return actions
    }

    // Speech has started: end the turn after enough silence, or at the hard cap.
    if (now - this.speechStartedAt >= this.config.maxTurnDuration) {
      this.ended = true
      actions.push({ type: 'TURN_ENDED', reason: 'maxDuration' })
      return actions
    }

    if (this.voicedSince === null && this.lastVoicedAt !== null) {
      const silence = now - this.lastVoicedAt
      if (silence >= this.endThreshold()) {
        this.ended = true
        actions.push({ type: 'TURN_ENDED', reason: 'silence' })
      }
    }
    return actions
  }

  /** The silence needed to end the turn now, chosen from how the partial transcript looks. */
  endThreshold(): number {
    const finished = looksFinished(this.partial, this.language, this.unfinished)
    if (finished === null) return this.config.endSilenceDefault
    return finished ? this.config.endSilenceComplete : this.config.endSilenceIncomplete
  }

  /** For the debug overlay. */
  snapshot(now: number): TurnSnapshot {
    return {
      speechStarted: this.speechStarted,
      sinceMicOpen: Math.max(0, now - this.micOpenedAt),
      silence: this.lastVoicedAt !== null && this.voicedSince === null ? now - this.lastVoicedAt : null,
      endThreshold: this.speechStarted ? this.endThreshold() : null,
    }
  }
}
