import { afterEach, describe, expect, it } from 'vitest'
import { beginPlayback, endPlayback, envelopeFromSamples, getVoiceNow, levelAt } from './voiceLevel'

const RATE = 1000 // 20 samples per 20 ms frame keeps the numbers easy

function tone(seconds: number, amplitude: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin(i * 0.9)
  return out
}

afterEach(() => endPlayback())

describe('envelopeFromSamples', () => {
  it('has one value per 20 ms', () => {
    expect(envelopeFromSamples(tone(1, 0.5), RATE).length).toBe(50)
  })

  it('scales quiet and loud recordings to the same range', () => {
    const quiet = envelopeFromSamples(tone(1, 0.05), RATE)
    const loud = envelopeFromSamples(tone(1, 0.9), RATE)
    expect(Math.max(...quiet)).toBeCloseTo(Math.max(...loud), 1)
    expect(Math.max(...quiet)).toBeLessThanOrEqual(1)
  })

  it('is near zero in the gaps between words', () => {
    const speech = new Float32Array(2000)
    speech.set(tone(1, 0.5), 0) // 1 s of voice, 1 s of silence
    const env = envelopeFromSamples(speech, RATE)
    expect(levelAt(env, 0.5)).toBeGreaterThan(0.8)
    expect(levelAt(env, 1.5)).toBeLessThan(0.05)
  })

  it('returns zeros for silence instead of amplifying noise', () => {
    const env = envelopeFromSamples(new Float32Array(1000), RATE)
    expect(Math.max(...env)).toBe(0)
  })
})

describe('levelAt', () => {
  it('is 0 before the start and after the end', () => {
    const env = envelopeFromSamples(tone(1, 0.5), RATE)
    expect(levelAt(env, -1)).toBe(0)
    expect(levelAt(env, 5)).toBe(0)
  })
})

describe('playback registry', () => {
  it('says nothing is playing, then measures while it plays', () => {
    expect(getVoiceNow().kind).toBe('none')
    const env = envelopeFromSamples(tone(1, 0.5), RATE)
    beginPlayback(env, () => 0.5)
    const now = getVoiceNow()
    expect(now.kind).toBe('real')
    if (now.kind === 'real') expect(now.level).toBeGreaterThan(0.8)
  })

  it('reports "unknown" when the recording could not be measured', () => {
    beginPlayback(null, () => 0)
    expect(getVoiceNow().kind).toBe('unknown')
  })

  it("an old playback ending does not stop a newer one", () => {
    const first = beginPlayback(null, () => 0)
    beginPlayback(null, () => 0)
    endPlayback(first)
    expect(getVoiceNow().kind).toBe('unknown')
  })
})
