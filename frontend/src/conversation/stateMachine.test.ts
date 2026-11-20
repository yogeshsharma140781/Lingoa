import { describe, expect, it } from 'vitest'
import {
  autoContinues,
  describeState,
  initialState,
  STATE_NAMES,
  transition,
  type ConversationEvent,
  type ConversationState,
} from './stateMachine'

const run = (start: ConversationState, ...events: ConversationEvent[]) =>
  events.reduce(transition, start)

describe('the happy path', () => {
  it('goes AI speaks -> listening -> speaking -> processing -> feedback -> AI speaks', () => {
    let s = initialState
    expect(s.name).toBe('aiSpeaking')
    s = transition(s, { type: 'AI_AUDIO_ENDED' })
    expect(s.name).toBe('userListening')
    s = transition(s, { type: 'SPEECH_STARTED' })
    expect(s.name).toBe('userSpeaking')
    s = transition(s, { type: 'TURN_ENDED' })
    expect(s.name).toBe('processing')
    s = transition(s, { type: 'EVALUATION_READY', level: 'good' })
    expect(s).toEqual({ name: 'feedback', level: 'good' })
    s = transition(s, { type: 'CONTINUE' })
    expect(s.name).toBe('aiSpeaking')
  })
})

describe('waiting, hints and resting', () => {
  it('listening -> waiting -> hint -> speaking', () => {
    const s = run(
      { name: 'userListening' },
      { type: 'WAITING_TIMEOUT' },
      { type: 'SHOW_HINT' },
      { type: 'SPEECH_STARTED' },
    )
    expect(s.name).toBe('userSpeaking')
  })

  it('speech from waiting goes to speaking', () => {
    expect(run({ name: 'userWaiting' }, { type: 'SPEECH_STARTED' }).name).toBe('userSpeaking')
  })

  it('waiting and hint both rest after restingDelay, and a tap returns to listening', () => {
    expect(run({ name: 'userWaiting' }, { type: 'RESTING_TIMEOUT' }).name).toBe('resting')
    expect(run({ name: 'hintShown' }, { type: 'RESTING_TIMEOUT' }).name).toBe('resting')
    expect(run({ name: 'resting' }, { type: 'TAP_AVATAR' }).name).toBe('userListening')
    expect(run({ name: 'resting' }, { type: 'AI_AUDIO_STARTED' }).name).toBe('aiSpeaking') // Replay
  })

  it('Replay (AI audio starting again) interrupts listening, waiting and hint, then listening resumes', () => {
    for (const name of ['userListening', 'userWaiting', 'hintShown'] as const) {
      const s = run({ name }, { type: 'AI_AUDIO_STARTED' }, { type: 'AI_AUDIO_ENDED' })
      expect(s.name).toBe('userListening')
    }
  })
})

describe('speech that turns out to be noise, and turns with nothing in them', () => {
  it('cancelled speech goes back to listening', () => {
    expect(run({ name: 'userSpeaking' }, { type: 'SPEECH_CANCELLED' }).name).toBe('userListening')
  })

  it('a discarded turn goes back to listening instead of showing feedback', () => {
    expect(run({ name: 'processing' }, { type: 'TURN_DISCARDED' }).name).toBe('userListening')
  })

  it('both are ignored anywhere else', () => {
    const idle: ConversationState = { name: 'userListening' }
    expect(transition(idle, { type: 'SPEECH_CANCELLED' })).toBe(idle)
    expect(transition(idle, { type: 'TURN_DISCARDED' })).toBe(idle)
    const speaking: ConversationState = { name: 'userSpeaking' }
    expect(transition(speaking, { type: 'TURN_DISCARDED' })).toBe(speaking)
  })
})

describe('retry feedback', () => {
  const retry: ConversationState = { name: 'feedback', level: 'retry' }

  it('Try again returns to listening; Skip moves on', () => {
    expect(transition(retry, { type: 'TRY_AGAIN' }).name).toBe('userListening')
    expect(transition(retry, { type: 'SKIP' }).name).toBe('aiSpeaking')
  })

  it('there is no Continue after a retry', () => {
    expect(transition(retry, { type: 'CONTINUE' })).toBe(retry)
  })

  it('Try again and Skip are only for retry', () => {
    const good: ConversationState = { name: 'feedback', level: 'good' }
    expect(transition(good, { type: 'TRY_AGAIN' })).toBe(good)
    expect(transition(good, { type: 'SKIP' })).toBe(good)
  })
})

describe('events that make no sense are ignored', () => {
  it('returns the very same state object', () => {
    const cases: Array<[ConversationState, ConversationEvent]> = [
      [{ name: 'aiSpeaking' }, { type: 'SPEECH_STARTED' }],
      [{ name: 'aiSpeaking' }, { type: 'TURN_ENDED' }],
      [{ name: 'userSpeaking' }, { type: 'WAITING_TIMEOUT' }],
      [{ name: 'userSpeaking' }, { type: 'AI_AUDIO_STARTED' }],
      [{ name: 'processing' }, { type: 'SPEECH_STARTED' }],
      [{ name: 'processing' }, { type: 'CONTINUE' }],
      [{ name: 'resting' }, { type: 'SPEECH_STARTED' }],
      [{ name: 'userListening' }, { type: 'CONTINUE' }],
    ]
    for (const [state, event] of cases) expect(transition(state, event)).toBe(state)
  })
})

describe('describeState', () => {
  const view = (name: ConversationState['name']) =>
    describeState(name === 'feedback' ? { name, level: 'good' } : ({ name } as ConversationState))

  it('the mic is open only while listening, speaking, waiting or showing a hint', () => {
    const open = STATE_NAMES.filter((n) => view(n).micOpen)
    expect(open.sort()).toEqual(['hintShown', 'userListening', 'userSpeaking', 'userWaiting'].sort())
  })

  it('the ring is solid only while the AI speaks', () => {
    expect(STATE_NAMES.filter((n) => view(n).ring === 'solid')).toEqual(['aiSpeaking'])
  })

  it('the AI line stays at full contrast while the learner answers, and dims only in feedback', () => {
    expect(STATE_NAMES.filter((n) => view(n).aiLineDimmed)).toEqual(['feedback'])
  })

  it('Replay and Translate are always there, so the layout never jumps', () => {
    for (const n of STATE_NAMES) expect(view(n).showAiActions).toBe(true)
  })

  it('shows the hint button when waiting and the hint card after it is tapped', () => {
    expect(view('userWaiting').showHintButton).toBe(true)
    expect(view('userWaiting').showHintCard).toBe(false)
    expect(view('hintShown').showHintButton).toBe(false)
    expect(view('hintShown').showHintCard).toBe(true)
  })

  it('only resting makes the avatar tappable', () => {
    expect(STATE_NAMES.filter((n) => view(n).avatarTappable)).toEqual(['resting'])
    expect(view('resting').avatarLabel).toBe('Tap to continue')
  })

  it('feedback shows Continue, or Try again and Skip for a retry', () => {
    expect(describeState({ name: 'feedback', level: 'excellent' })).toMatchObject({ showContinue: true, showRetry: false, showTranscript: true })
    expect(describeState({ name: 'feedback', level: 'almost' }).showContinue).toBe(true)
    expect(describeState({ name: 'feedback', level: 'retry' })).toMatchObject({ showContinue: false, showRetry: true })
  })

  it('every state has a screen-reader announcement', () => {
    for (const n of STATE_NAMES) expect(view(n).announcement.length).toBeGreaterThan(0)
  })
})

describe('autoContinues (a fine answer moves on by itself)', () => {
  it('moves on when the answer was fine and there is nothing to study', () => {
    expect(autoContinues({ name: 'feedback', level: 'excellent' }, false)).toBe(true)
    // the judge was unavailable: counts as fine, with no alternative
    expect(autoContinues({ name: 'feedback', level: 'good' }, false)).toBe(true)
  })

  it('waits for the learner when there is an alternative to read or hear', () => {
    expect(autoContinues({ name: 'feedback', level: 'good' }, true)).toBe(false)
    expect(autoContinues({ name: 'feedback', level: 'almost' }, true)).toBe(false)
  })

  it('never moves on from a retry: that needs a choice', () => {
    expect(autoContinues({ name: 'feedback', level: 'retry' }, false)).toBe(false)
  })

  it('only applies to the feedback screen', () => {
    expect(autoContinues({ name: 'userListening' }, false)).toBe(false)
    expect(autoContinues({ name: 'processing' }, false)).toBe(false)
  })
})
