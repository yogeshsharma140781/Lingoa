// Remembers every microphone stream the app opens, so none can be left running without an owner.
//
// A stream nobody stops keeps the microphone (and the orange dot) on, and on iOS can keep the phone from
// sleeping. It happens when getUserMedia answers after the code that asked has already given up (a timeout)
// or moved on. Wrapping getUserMedia once lets us see all open streams and stop the strays.

const open = new Set<MediaStream>()
let installed = false

export function installMicTracker(): void {
  if (installed || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return
  installed = true
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    const stream = await original(constraints)
    open.add(stream)
    return stream
  }
}

function hasLiveTrack(stream: MediaStream): boolean {
  return stream.getTracks().some((t) => t.readyState === 'live')
}

/** How many streams are still capturing right now. */
export function liveMicStreamCount(): number {
  for (const s of [...open]) if (!hasLiveTrack(s)) open.delete(s)
  return open.size
}

/** Stop every open stream except `keep`. Returns how many were stopped. */
export function stopStrayMicStreams(keep: MediaStream | null): number {
  let stopped = 0
  for (const s of [...open]) {
    if (s === keep) continue
    if (hasLiveTrack(s)) {
      s.getTracks().forEach((t) => t.stop())
      stopped += 1
    }
    open.delete(s)
  }
  return stopped
}
