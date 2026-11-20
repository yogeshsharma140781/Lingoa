// How loud the AI's voice is, moment by moment, so the avatar's mouth can follow it.
//
// The recording is analysed BEFORE it plays (one number per 20 ms), and while it plays the avatar
// looks up the number for the current playback position. The sound itself is never routed through
// an analyser, so this cannot change how the voice sounds or break playback on iOS.

const HOP_SECONDS = 0.02

/** One loudness value (0..1) per 20 ms. Quiet recordings are scaled up so every voice moves the mouth alike. */
export function envelopeFromSamples(samples: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SECONDS))
  const frames = Math.ceil(samples.length / hop)
  const rms = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    const start = f * hop
    const end = Math.min(samples.length, start + hop)
    let sum = 0
    for (let i = start; i < end; i++) sum += samples[i] * samples[i]
    rms[f] = Math.sqrt(sum / Math.max(1, end - start))
  }
  if (frames === 0) return rms
  const sorted = Float32Array.from(rms).sort()
  const loud = sorted[Math.floor(0.95 * (frames - 1))]
  if (loud < 1e-4) return new Float32Array(frames) // silence
  for (let f = 0; f < frames; f++) rms[f] = Math.min(1, rms[f] / loud)
  return rms
}

/** The loudness at a moment in the recording (0 outside it). */
export function levelAt(envelope: Float32Array, seconds: number): number {
  if (!(seconds >= 0)) return 0
  const pos = seconds / HOP_SECONDS
  const i = Math.floor(pos)
  if (i >= envelope.length) return 0
  const a = envelope[i]
  const b = i + 1 < envelope.length ? envelope[i + 1] : a
  return a + (b - a) * (pos - i)
}

/** Decode a recording and measure it. null if the device cannot (the avatar then uses a gentle stand-in). */
export async function computeEnvelope(blob: Blob): Promise<Float32Array | null> {
  try {
    const Ctx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext
    if (!Ctx) return null
    const ctx = new Ctx(1, 1, 44100)
    const data = await blob.arrayBuffer()
    const buffer: AudioBuffer = await new Promise((resolve, reject) => {
      const maybe = ctx.decodeAudioData(data, resolve, reject)
      if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject)
    })
    return envelopeFromSamples(buffer.getChannelData(0), buffer.sampleRate)
  } catch {
    return null
  }
}

// ---- what is playing right now ----

interface Playback {
  id: number
  envelope: Float32Array | null
  /** Seconds into the recording. */
  position: () => number
}

let active: Playback | null = null
let nextId = 1

/** The voice started playing. Returns a handle for endPlayback. */
export function beginPlayback(envelope: Float32Array | null, position: () => number): number {
  const id = nextId++
  active = { id, envelope, position }
  return id
}

/** The measurement finished after the voice had already started. */
export function setPlaybackEnvelope(id: number, envelope: Float32Array | null) {
  if (active?.id === id) active.envelope = envelope
}

/** The voice stopped. With a handle, only ends that playback (not a newer one that already started). */
export function endPlayback(id?: number) {
  if (id === undefined || active?.id === id) active = null
}

export type VoiceNow =
  | { kind: 'real'; level: number } // measured from the recording
  | { kind: 'unknown' } // something is playing but could not be measured
  | { kind: 'none' } // nothing is playing

export function getVoiceNow(): VoiceNow {
  if (!active) return { kind: 'none' }
  if (!active.envelope) return { kind: 'unknown' }
  return { kind: 'real', level: levelAt(active.envelope, active.position()) }
}
