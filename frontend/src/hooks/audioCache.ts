// Remembers the audio of what the AI said, so that "Replay" plays exactly the same recording again.
// The voice service varies its delivery every time it is asked to speak a sentence, so asking again
// would sound different (pitch, pace, tone). Keyed by language, speed and text; keeps the latest few.

const MAX_ENTRIES = 40
const cache = new Map<string, string>()

export const audioKey = (text: string, language: string, speed: number) => `${language}|${speed}|${text}`

export function getCachedAudio(key: string): string | undefined {
  const hit = cache.get(key)
  if (hit !== undefined) {
    // most recently used goes to the end
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

export function cacheAudio(key: string, base64Audio: string): void {
  if (!base64Audio) return
  cache.delete(key)
  cache.set(key, base64Audio)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function clearAudioCache(): void {
  cache.clear()
}
