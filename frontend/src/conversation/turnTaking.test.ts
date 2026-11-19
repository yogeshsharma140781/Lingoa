import { describe, expect, it } from 'vitest'
import { DEFAULT_TURN_CONFIG } from './config'
import { looksFinished, TurnTaker, type TurnAction } from './turnTaking'

// A fake clock: `run` steps time in 100 ms frames, feeding the voice detector and ticking.
function harness(language = 'nl', config = DEFAULT_TURN_CONFIG) {
  const taker = new TurnTaker(config, language)
  let now = 0
  const log: Array<{ at: number; action: TurnAction }> = []
  taker.open(now)

  /** Advance `seconds`, with `voiced` true or false for the whole span. */
  const run = (seconds: number, voiced: boolean) => {
    const steps = Math.round(seconds * 10)
    for (let i = 0; i < steps; i++) {
      now = Math.round((now + 0.1) * 10) / 10
      taker.voice(now, voiced)
      for (const action of taker.tick(now)) log.push({ at: now, action })
    }
  }
  const types = () => log.map((l) => l.action.type)
  return { taker, run, log, types, now: () => now }
}

describe('looksFinished', () => {
  it('treats sentence-final punctuation as finished', () => {
    expect(looksFinished('Mag ik een cappuccino alsjeblieft?', 'nl')).toBe(true)
    expect(looksFinished('Ik heb honger.', 'nl')).toBe(true)
  })
  it('treats a trailing content word as finished', () => {
    expect(looksFinished('Ik wil een cappuccino', 'nl')).toBe(true)
  })
  it('treats a trailing conjunction, article, preposition or filler as unfinished', () => {
    expect(looksFinished('Ik wil een cappuccino en', 'nl')).toBe(false)
    expect(looksFinished('Ik wil een', 'nl')).toBe(false)
    expect(looksFinished('Ik ga naar de', 'nl')).toBe(false)
    expect(looksFinished('Mag ik uh', 'nl')).toBe(false)
    expect(looksFinished('Quiero un café y', 'es')).toBe(false)
  })
  it('treats a trailing ellipsis or comma as unfinished, even after a content word', () => {
    expect(looksFinished('Ik wil een cappuccino…', 'nl')).toBe(false)
    expect(looksFinished('Ik wil een cappuccino...', 'nl')).toBe(false)
    expect(looksFinished('Ik wil een cappuccino,', 'nl')).toBe(false)
  })
  it('returns null when there is nothing to judge', () => {
    expect(looksFinished('', 'nl')).toBeNull()
    expect(looksFinished('   ', 'nl')).toBeNull()
    expect(looksFinished(null, 'nl')).toBeNull()
  })
  it('handles languages written without spaces', () => {
    expect(looksFinished('我想喝咖啡。', 'zh')).toBe(true)
    expect(looksFinished('我想喝咖啡和', 'zh')).toBe(false)
  })
  it('falls back to English word lists for unknown languages', () => {
    expect(looksFinished('I want coffee and', 'xx')).toBe(false)
  })
})

describe('looksFinished in Hindi (vowel signs must survive)', () => {
  it('a sentence that ends on a linking word is not finished', () => {
    expect(looksFinished('मैं बाज़ार गया था लेकिन', 'hi')).toBe(false)
    expect(looksFinished('मैं घर नहीं गया क्योंकि', 'hi')).toBe(false)
    expect(looksFinished('वह दिल्ली में', 'hi')).toBe(false)
    expect(looksFinished('यह मेरे दोस्त का', 'hi')).toBe(false)
  })

  it('a sentence that ends on a content word is finished', () => {
    expect(looksFinished('मैं आज बाज़ार जा रहा हूँ', 'hi')).toBe(true)
    expect(looksFinished('मुझे एक कप चाय चाहिए', 'hi')).toBe(true)
  })

  it('trailing Hindi punctuation does not hide the last word', () => {
    expect(looksFinished('मैं बाज़ार गया था लेकिन,', 'hi')).toBe(false)
    expect(looksFinished('मैं घर जाता हूँ।', 'hi')).toBe(true)
  })
})

describe('before any speech', () => {
  it('never submits silence: only escalates to waiting, then resting', () => {
    const h = harness()
    h.run(5.9, false)
    expect(h.types()).toEqual([])
    h.run(0.2, false) // crosses waitingDelay (6 s)
    expect(h.types()).toEqual(['WAITING_TIMEOUT'])
    h.run(30, false) // 36 s: still waiting
    expect(h.types()).toEqual(['WAITING_TIMEOUT'])
    h.run(10, false) // crosses restingDelay (45 s)
    expect(h.types()).toEqual(['WAITING_TIMEOUT', 'RESTING_TIMEOUT'])
    expect(h.types()).not.toContain('TURN_ENDED')
  })

  it('emits each timeout only once, and stops after resting', () => {
    const h = harness()
    h.run(120, false)
    expect(h.types()).toEqual(['WAITING_TIMEOUT', 'RESTING_TIMEOUT'])
  })

  it('reopening the mic starts the timers over', () => {
    const h = harness()
    h.run(50, false)
    h.taker.open(h.now())
    h.run(5.9, false)
    expect(h.types()).toEqual(['WAITING_TIMEOUT', 'RESTING_TIMEOUT'])
    h.run(0.2, false)
    expect(h.types()).toEqual(['WAITING_TIMEOUT', 'RESTING_TIMEOUT', 'WAITING_TIMEOUT'])
  })
})

describe('speech detection', () => {
  it('ignores sounds shorter than minSpeechDuration', () => {
    const h = harness()
    h.run(0.2, true) // a blip
    h.run(5, false)
    expect(h.types()).toEqual([])
  })

  it('a blip does not cancel the waiting timer', () => {
    const h = harness()
    h.run(5, false)
    h.run(0.2, true)
    h.run(1, false) // 6.2 s since the mic opened
    expect(h.types()).toEqual(['WAITING_TIMEOUT'])
  })

  it('counts a voiced run of at least minSpeechDuration as speech', () => {
    const h = harness()
    h.run(0.4, true)
    expect(h.types()).toEqual(['SPEECH_STARTED'])
  })

  it('emits SPEECH_STARTED once per turn', () => {
    const h = harness()
    h.run(1, true)
    h.run(0.5, false)
    h.run(1, true)
    expect(h.types().filter((t) => t === 'SPEECH_STARTED')).toHaveLength(1)
  })

  it('speech after "take your time" still counts', () => {
    const h = harness()
    h.run(7, false)
    h.run(1, true)
    expect(h.types()).toEqual(['WAITING_TIMEOUT', 'SPEECH_STARTED'])
  })
})

describe('ending a turn', () => {
  it('uses endSilenceDefault with no partial transcript', () => {
    const h = harness()
    h.run(1, true)
    h.run(2.4, false)
    expect(h.types()).not.toContain('TURN_ENDED')
    h.run(0.2, false) // 2.6 s of silence >= 2.5
    expect(h.types()).toContain('TURN_ENDED')
  })

  it('ends sooner (1.5 s) when the partial transcript looks finished', () => {
    const h = harness()
    h.taker.setPartialTranscript('Mag ik een cappuccino alsjeblieft?')
    h.run(1, true)
    h.run(1.4, false)
    expect(h.types()).not.toContain('TURN_ENDED')
    h.run(0.2, false)
    expect(h.types()).toContain('TURN_ENDED')
  })

  it('waits longer (3.5 s) when the partial transcript looks unfinished', () => {
    const h = harness()
    h.taker.setPartialTranscript('Ik wil graag een')
    h.run(1, true)
    h.run(3.4, false)
    expect(h.types()).not.toContain('TURN_ENDED')
    h.run(0.2, false)
    expect(h.types()).toContain('TURN_ENDED')
  })

  it('does not cut off a learner who pauses mid-sentence and then continues', () => {
    const h = harness()
    h.taker.setPartialTranscript('Ik wil een')
    h.run(1, true)
    h.run(3, false) // a long pause, but under 3.5 s
    h.run(1, true) // continues
    h.taker.setPartialTranscript('Ik wil een cappuccino.')
    h.run(1.6, false)
    expect(h.types().filter((t) => t === 'TURN_ENDED')).toHaveLength(1)
    // ...and only after the second pause:
    expect(h.log.find((l) => l.action.type === 'TURN_ENDED')!.at).toBeGreaterThan(6)
  })

  it('resets the silence clock whenever the learner speaks again', () => {
    const h = harness()
    h.run(1, true)
    h.run(2, false)
    h.run(0.5, true)
    h.run(2, false)
    expect(h.types()).not.toContain('TURN_ENDED') // 2 s < 2.5 s each time
  })

  it('uses the partial transcript at decision time (it can change while waiting)', () => {
    const h = harness()
    h.taker.setPartialTranscript('Ik wil een')
    h.run(1, true)
    h.run(2, false)
    h.taker.setPartialTranscript('Ik wil een cappuccino.') // arrives late and looks finished
    h.run(0.1, false)
    expect(h.types()).toContain('TURN_ENDED') // 2.1 s >= 1.5 s
  })

  it('caps a turn at maxTurnDuration even if the learner never pauses', () => {
    const h = harness()
    h.run(61, true)
    const ended = h.log.find((l) => l.action.type === 'TURN_ENDED')
    expect(ended).toBeDefined()
    expect(ended!.action).toEqual({ type: 'TURN_ENDED', reason: 'maxDuration' })
  })

  it('emits TURN_ENDED only once', () => {
    const h = harness()
    h.run(1, true)
    h.run(10, false)
    expect(h.types().filter((t) => t === 'TURN_ENDED')).toHaveLength(1)
  })
})

describe('a closed mic', () => {
  it('decides nothing while the AI speaks or a hint plays', () => {
    const h = harness()
    h.taker.close()
    h.run(60, false)
    h.run(2, true)
    expect(h.types()).toEqual([])
  })

  it('every threshold comes from the config', () => {
    const h = harness('nl', { ...DEFAULT_TURN_CONFIG, waitingDelay: 2, endSilenceDefault: 1 })
    h.run(2.1, false)
    expect(h.types()).toEqual(['WAITING_TIMEOUT'])
    h.run(1, true)
    h.run(1.1, false)
    expect(h.types()).toContain('TURN_ENDED')
  })
})

describe('cancelled speech (it was only noise)', () => {
  it('goes back to waiting for real speech, without restarting the mic clock', () => {
    const h = harness()
    h.run(2, true) // sounded like speech
    expect(h.types()).toEqual(['SPEECH_STARTED'])
    h.taker.cancelSpeech()
    h.run(10, false) // silence now: must NOT end a turn that never really started
    // The mic opened 12 s ago, so "take your time" is due: the clock was not restarted.
    expect(h.types()).toEqual(['SPEECH_STARTED', 'WAITING_TIMEOUT'])
  })

  it('real speech afterwards starts a normal turn', () => {
    const h = harness()
    h.run(1, true)
    h.taker.cancelSpeech()
    h.run(0.5, false)
    h.run(1, true)
    h.run(3, false)
    expect(h.types()).toEqual(['SPEECH_STARTED', 'SPEECH_STARTED', 'TURN_ENDED'])
  })
})

describe('debug snapshot', () => {
  it('reports the timers the overlay shows', () => {
    const h = harness()
    h.run(2, false)
    expect(h.taker.snapshot(h.now())).toMatchObject({ speechStarted: false, endThreshold: null })
    h.run(1, true)
    h.run(1, false)
    const snap = h.taker.snapshot(h.now())
    expect(snap.speechStarted).toBe(true)
    expect(snap.silence).toBeCloseTo(1, 1)
    expect(snap.endThreshold).toBe(2.5)
  })
})
