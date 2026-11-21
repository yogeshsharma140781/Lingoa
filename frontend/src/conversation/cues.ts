// Two short sounds that mark the turn-taking: a rising pair when it is the learner's turn to speak, a
// falling pair when their turn has ended (they pressed Done, or the silence ended it). Made with Web Audio
// (no sound files), quiet on purpose, and switched off by the learner with the speaker button.

import { getAudioContext } from '../hooks/useApi'
import { useStore } from '../store'
import { CUE_PEAK, CUE_WAIT_MS, cueNotes, type Cue } from './cueSounds'

/** Play a cue. Resolves when it is safe to go on (see CUE_WAIT_MS); resolves at once if the sounds are off or cannot play. */
export async function playCue(cue: Cue): Promise<void> {
  if (!useStore.getState().cuesEnabled) return
  try {
    const ctx = getAudioContext()
    if (ctx.state !== 'running') {
      await Promise.race([ctx.resume().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 300))])
    }
    if (ctx.state !== 'running') return // iOS has not let this context start: skip the sound rather than delay anything
    const t0 = ctx.currentTime + 0.02
    for (const n of cueNotes(cue)) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(n.freq, t0 + n.at)
      gain.gain.setValueAtTime(0.0001, t0 + n.at)
      gain.gain.linearRampToValueAtTime(CUE_PEAK, t0 + n.at + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0 + n.at)
      osc.stop(t0 + n.at + n.dur + 0.02)
    }
  } catch (err) {
    console.warn('[Cue] could not play', cue, err)
    return
  }
  const wait = CUE_WAIT_MS[cue]
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
}
