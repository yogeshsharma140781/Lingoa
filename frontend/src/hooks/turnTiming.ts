// How long the app waits before it treats a pause as "done talking".
//
// A learner forming a sentence in a second language pauses a lot mid-thought,
// so these waits are deliberately generous. The silence wait counts from the
// moment speech stops; the grace window is a final second where the pill says
// "Got it, sending..." but nothing has been sent yet - speaking again cancels it.

// useVoiceActivity flips isSpeaking to false after this much silence, so it's
// already "spent" by the time our own timer starts.
export const VAD_PAUSE_MS = 600

// Total silence after speech before the pill switches to "sending".
const SILENCE_WAIT_MS = 3000
// A very short phrase followed by a pause is more likely a thought in progress
// than a finished answer, so wait longer after it.
const SILENCE_WAIT_SHORT_PHRASE_MS = 4000
export const SHORT_PHRASE_SPEECH_MS = 3000

// Final window in which speaking again cancels the send.
export const GRACE_MS = 1000

// Before the user has said anything this turn: after this much quiet, offer
// reply suggestions on their own (they can always open them with "Need help?").
export const SUGGESTIONS_AUTO_OPEN_MS = 7000

/** Total silence (ms, measured from when speech stopped) to wait before the grace window starts. */
export function silenceWaitMs(turnSpeechMs: number): number {
  return turnSpeechMs < SHORT_PHRASE_SPEECH_MS ? SILENCE_WAIT_SHORT_PHRASE_MS : SILENCE_WAIT_MS
}
