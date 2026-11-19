import { beforeEach, describe, expect, it } from 'vitest'
import { audioKey, cacheAudio, clearAudioCache, getCachedAudio } from './audioCache'

beforeEach(clearAudioCache)

describe('audio cache (Replay plays the same recording)', () => {
  it('returns what was stored, for the same text, language and speed', () => {
    cacheAudio(audioKey('Hallo!', 'nl', 0.9), 'AAAA')
    expect(getCachedAudio(audioKey('Hallo!', 'nl', 0.9))).toBe('AAAA')
  })

  it('does not mix up different text, language or speed', () => {
    cacheAudio(audioKey('Hallo!', 'nl', 0.9), 'AAAA')
    expect(getCachedAudio(audioKey('Hallo.', 'nl', 0.9))).toBeUndefined()
    expect(getCachedAudio(audioKey('Hallo!', 'de', 0.9))).toBeUndefined()
    expect(getCachedAudio(audioKey('Hallo!', 'nl', 1))).toBeUndefined()
  })

  it('keeps only the most recent entries', () => {
    for (let i = 0; i < 50; i++) cacheAudio(audioKey(`line ${i}`, 'nl', 1), `audio${i}`)
    expect(getCachedAudio(audioKey('line 0', 'nl', 1))).toBeUndefined() // oldest dropped
    expect(getCachedAudio(audioKey('line 49', 'nl', 1))).toBe('audio49')
  })

  it('using an entry keeps it from being dropped first', () => {
    for (let i = 0; i < 40; i++) cacheAudio(audioKey(`line ${i}`, 'nl', 1), `audio${i}`)
    getCachedAudio(audioKey('line 0', 'nl', 1)) // use the oldest one
    cacheAudio(audioKey('one more', 'nl', 1), 'x') // pushes one entry out: line 1, not line 0
    expect(getCachedAudio(audioKey('line 0', 'nl', 1))).toBe('audio0')
    expect(getCachedAudio(audioKey('line 1', 'nl', 1))).toBeUndefined()
  })

  it('ignores empty audio', () => {
    cacheAudio(audioKey('Hallo!', 'nl', 1), '')
    expect(getCachedAudio(audioKey('Hallo!', 'nl', 1))).toBeUndefined()
  })
})
