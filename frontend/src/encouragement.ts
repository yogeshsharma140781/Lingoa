// A little encouragement for learners: a cheer in the language they're
// practising after each real attempt, and a kind word when they finish.

// A short cheer in each supported language (shown big), so even praise is a
// tiny bit of exposure.
const CHEERS: Record<string, string> = {
  en: 'Great job!',
  es: '¡Muy bien!',
  fr: 'Très bien !',
  de: 'Super gemacht!',
  nl: 'Goed zo!',
  it: 'Ottimo!',
  pt: 'Muito bem!',
  hi: 'बहुत बढ़िया!',
  zh: '太棒了！',
  ja: 'すごい！',
  ko: '잘했어요!',
}

// English follow-up lines (shown small). Rotated so it doesn't feel canned.
const LINES = [
  'Nice one. Keep it going.',
  'You\'re doing great.',
  'Every sentence you say out loud counts.',
  'Speaking is the hard part, and you\'re doing it.',
]

export interface Praise {
  id: number
  cheer: string
  line: string
}

let nextId = 1
let lineIndex = 0

// CJK text has no spaces between words, so count characters for those.
const NO_SPACE_LANGUAGES = new Set(['zh', 'ja', 'ko'])

/** Did they actually say something worth a compliment (not a stray "hmm")? */
export function isPraiseworthy(transcript: string, languageCode: string): boolean {
  const text = transcript.trim()
  if (!text) return false
  if (NO_SPACE_LANGUAGES.has(languageCode)) return text.length >= 3
  return text.split(/\s+/).length >= 2
}

export function pickPraise(languageCode: string): Praise {
  const line = LINES[lineIndex % LINES.length]
  lineIndex += 1
  return { id: nextId++, cheer: CHEERS[languageCode] ?? CHEERS.en, line }
}

/** Bigger moment: first time they reach the daily goal in a session. */
export function goalPraise(languageCode: string, goalLabel: string): Praise {
  return {
    id: nextId++,
    cheer: CHEERS[languageCode] ?? CHEERS.en,
    line: `Daily goal reached: a full ${goalLabel} of speaking. Keep going as long as you like.`,
  }
}

export interface SessionWrapUp {
  speakingMs: number
  hitGoal: boolean
  languageCode: string
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes === 0) return `${seconds} sec`
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} sec`
}

/** What to say when they leave the conversation. */
export function wrapUpMessage(wrapUp: SessionWrapUp, languageName: string): { title: string; body: string } {
  const spoke = formatDuration(wrapUp.speakingMs)
  if (wrapUp.hitGoal) {
    return { title: 'Goal done!', body: `You spoke ${languageName} for ${spoke} today. Great work.` }
  }
  if (wrapUp.speakingMs >= 20000) {
    return { title: 'Nice work', body: `${spoke} of ${languageName} today. Every bit counts.` }
  }
  return { title: 'Good start', body: 'Come back tomorrow and go a little longer. You\'ve got this.' }
}
