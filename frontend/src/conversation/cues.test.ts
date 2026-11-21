import { describe, expect, it } from 'vitest'
import { CUE_WAIT_MS, cueNotes } from './cueSounds'

describe('cues', () => {
  it('"your turn" rises and "done" falls', () => {
    const up = cueNotes('yourTurn')
    const down = cueNotes('done')
    expect(up[1].freq).toBeGreaterThan(up[0].freq)
    expect(down[1].freq).toBeLessThan(down[0].freq)
  })

  it('both cues use the same two notes, so they sound like a pair', () => {
    const freqs = (c: 'yourTurn' | 'done') => cueNotes(c).map((n) => n.freq).sort()
    expect(freqs('yourTurn')).toEqual(freqs('done'))
  })

  it('each cue is short (under a third of a second)', () => {
    for (const c of ['yourTurn', 'done'] as const) {
      const end = Math.max(...cueNotes(c).map((n) => n.at + n.dur))
      expect(end).toBeLessThan(0.34)
    }
  })

  it('only "your turn" holds anything back (the microphone opens after it)', () => {
    expect(CUE_WAIT_MS.yourTurn).toBeGreaterThan(0)
    expect(CUE_WAIT_MS.done).toBe(0)
  })
})
