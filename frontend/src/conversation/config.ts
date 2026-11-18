// Every tunable number and word list for the conversation screen lives here.
// The starting values are guesses to be tuned by testing on a real device.

export interface TurnConfig {
  /** No speech this long after the mic opens -> "Take your time..." (userWaiting). Seconds. */
  waitingDelay: number
  /** No speech this long -> the mic closes and the screen rests ("Tap to continue"). Seconds. */
  restingDelay: number
  /** Silence that ends a turn when the partial transcript looks finished. Seconds. */
  endSilenceComplete: number
  /** Silence that ends a turn when the partial transcript looks unfinished. Seconds. */
  endSilenceIncomplete: number
  /** Silence that ends a turn when there is no partial transcript to judge. Seconds. */
  endSilenceDefault: number
  /** Sounds shorter than this (blips, background noise) never count as speech. Seconds. */
  minSpeechDuration: number
  /** Hard cap on one turn, measured from the first speech. Seconds. */
  maxTurnDuration: number
  /** Show a live transcript while the learner speaks (off in v1). */
  showLiveTranscript: boolean
}

export const DEFAULT_TURN_CONFIG: TurnConfig = {
  waitingDelay: 6,
  restingDelay: 45,
  endSilenceComplete: 1.5,
  endSilenceIncomplete: 3.5,
  endSilenceDefault: 2.5,
  minSpeechDuration: 0.3,
  maxTurnDuration: 60,
  showLiveTranscript: false,
}

/**
 * Words that signal "the sentence is not finished yet" when a transcript ends with one:
 * conjunctions, articles, prepositions and fillers. Lower-case, per language code.
 * Kept here (not in logic) so they can be tuned without touching code.
 */
export const UNFINISHED_ENDINGS: Record<string, string[]> = {
  en: ['and', 'but', 'or', 'because', 'so', 'then', 'the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'with', 'for', 'from', 'uh', 'um', 'er', 'like'],
  es: ['y', 'e', 'o', 'u', 'pero', 'porque', 'que', 'el', 'la', 'los', 'las', 'un', 'una', 'de', 'en', 'a', 'con', 'para', 'por', 'es', 'eh', 'este', 'bueno'],
  fr: ['et', 'ou', 'mais', 'parce', 'que', 'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'à', 'au', 'en', 'dans', 'avec', 'pour', 'euh', 'ben'],
  de: ['und', 'oder', 'aber', 'weil', 'dass', 'der', 'die', 'das', 'ein', 'eine', 'zu', 'von', 'in', 'an', 'auf', 'mit', 'für', 'äh', 'ähm'],
  nl: ['en', 'of', 'maar', 'omdat', 'dat', 'de', 'het', 'een', 'te', 'van', 'in', 'op', 'aan', 'met', 'voor', 'naar', 'uh', 'eh', 'euh', 'ehm'],
  it: ['e', 'o', 'ma', 'perché', 'che', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'di', 'a', 'in', 'con', 'per', 'eh', 'ehm', 'cioè'],
  pt: ['e', 'ou', 'mas', 'porque', 'que', 'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'em', 'com', 'para', 'por', 'é', 'hum', 'tipo'],
  hi: ['और', 'या', 'लेकिन', 'क्योंकि', 'कि', 'में', 'से', 'को', 'का', 'की', 'के', 'तो', 'अम्म'],
  zh: ['和', '但是', '因为', '所以', '的', '在', '跟', '嗯', '呃'],
  ja: ['と', 'や', 'でも', 'から', 'を', 'は', 'が', 'に', 'で', 'の', 'えっと', 'あの'],
  ko: ['그리고', '그런데', '하지만', '왜냐하면', '은', '는', '이', '가', '을', '를', '에', '의', '음', '어'],
}

/** Sentence-final punctuation (Latin, CJK and Devanagari danda). */
export const SENTENCE_FINAL = /[.!?。！？।]["')\]]?\s*$/

/** Trailing ellipsis / hesitation marks mean the speaker trailed off. */
export const TRAILING_OFF = /(\.{2,}|…|,|-|–|—)\s*$/

/** Persona name per language code (placeholder, read from config). */
export const PERSONA_NAMES: Record<string, string> = {
  en: 'Emma',
  es: 'Lucía',
  fr: 'Camille',
  de: 'Anna',
  nl: 'Anouk',
  it: 'Giulia',
  pt: 'Inês',
  hi: 'Ananya',
  zh: '小雅',
  ja: 'さくら',
  ko: '지은',
}

/** Built-in target-language reaction labels, used if the evaluation result has none. */
export const REACTION_FALLBACKS: Record<string, { excellent: string; good: string; almost: string; retry: string }> = {
  en: { excellent: 'Excellent!', good: 'Well done!', almost: 'Almost!', retry: 'Try again' },
  es: { excellent: '¡Excelente!', good: '¡Bien hecho!', almost: '¡Casi!', retry: 'Inténtalo otra vez' },
  fr: { excellent: 'Excellent !', good: 'Bien joué !', almost: 'Presque !', retry: 'Réessayez' },
  de: { excellent: 'Ausgezeichnet!', good: 'Gut gemacht!', almost: 'Fast!', retry: 'Versuch es noch einmal' },
  nl: { excellent: 'Uitstekend!', good: 'Goed gedaan!', almost: 'Bijna!', retry: 'Probeer het nog eens' },
  it: { excellent: 'Eccellente!', good: 'Ben fatto!', almost: 'Quasi!', retry: 'Riprova' },
  pt: { excellent: 'Excelente!', good: 'Muito bem!', almost: 'Quase!', retry: 'Tente outra vez' },
  hi: { excellent: 'बहुत बढ़िया!', good: 'अच्छा किया!', almost: 'लगभग!', retry: 'फिर से कोशिश करें' },
  zh: { excellent: '太棒了！', good: '做得好！', almost: '差一点！', retry: '再试一次' },
  ja: { excellent: '素晴らしい！', good: 'よくできました！', almost: 'おしい！', retry: 'もう一度やってみましょう' },
  ko: { excellent: '훌륭해요!', good: '잘했어요!', almost: '거의 다 됐어요!', retry: '다시 해 보세요' },
}

/**
 * What the learner is taken to have said when they press Skip, so the AI can move on
 * naturally ("I don't know"). Used only when the learner said nothing usable.
 */
export const SKIP_UTTERANCES: Record<string, string> = {
  en: "I don't know.",
  es: 'No lo sé.',
  fr: 'Je ne sais pas.',
  de: 'Das weiß ich nicht.',
  nl: 'Dat weet ik niet.',
  it: 'Non lo so.',
  pt: 'Não sei.',
  hi: 'मुझे नहीं पता।',
  zh: '我不知道。',
  ja: 'わかりません。',
  ko: '모르겠어요.',
}
