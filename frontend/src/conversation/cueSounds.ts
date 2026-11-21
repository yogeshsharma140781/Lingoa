// The notes of the two turn-taking sounds (see cues.ts, which plays them). Pure, so it can be tested.

export type Cue = 'yourTurn' | 'done'

export interface CueNote {
  /** Frequency in Hz. */
  freq: number
  /** Seconds after the cue starts. */
  at: number
  /** Seconds the note rings. */
  dur: number
}

const E5 = 659
const B5 = 988
/** Loudness of each note (0 to 1): quiet on purpose, the phone's volume sets the rest. */
export const CUE_PEAK = 0.2

/** The notes of each cue: rising means "go", falling means "stop". */
export function cueNotes(cue: Cue): CueNote[] {
  return cue === 'yourTurn'
    ? [
        { freq: E5, at: 0, dur: 0.16 },
        { freq: B5, at: 0.09, dur: 0.22 },
      ]
    : [
        { freq: B5, at: 0, dur: 0.12 },
        { freq: E5, at: 0.07, dur: 0.2 },
      ]
}

/**
 * How long to wait after starting a cue before doing the next thing (opening the microphone, which
 * must not hear it). A little shorter than the notes ring: the last bit of the tail is very quiet.
 */
export const CUE_WAIT_MS: Record<Cue, number> = { yourTurn: 260, done: 0 }
