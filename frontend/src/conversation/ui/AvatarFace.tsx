import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import { getVoiceNow } from '../voiceLevel'

// Anouk's face as a layered drawing, so the parts can move on their own:
// the mouth follows the AI's voice, the eyes blink, the head tilts and bobs a little.

export type FacePose =
  | 'speaking' //  the AI is talking: mouth follows the voice
  | 'listening' // the learner's turn: attentive, head slightly tilted
  | 'thinking' //  evaluating the answer: eyes glance up
  | 'happy' //     excellent / good
  | 'concerned' // almost / retry (gentle, not sad)
  | 'idle'

const INK = '#000'
const SKIN = '#f5b58f'
const HAIR = '#5e2b10'
const MOUTH_INSIDE = '#4a1d0d'

// The smile line from the drawing: M290.3,374.5 C296.5,389 310.1,384.2 313,373.9
const MOUTH_LEFT = { x: 290.3, y: 374.5 }
const MOUTH_RIGHT = { x: 313, y: 373.9 }
const MAX_OPEN = 20 // how far the lower lip drops when the voice is loudest
const LEFT_EYE = { x: 258, y: 314.2 }
const RIGHT_EYE = { x: 347.8, y: 314.2 }
const HEAD_PIVOT = '300 440'

function mouthPath(smile: number, open: number) {
  // smile: 1 = the drawing, >1 deeper smile, <1 flatter. open: how far the lower lip drops.
  const c1y = MOUTH_LEFT.y + 14.5 * smile
  const c2y = MOUTH_LEFT.y + 9.7 * smile
  const shift = open * 1.33 // a cubic curve's middle moves about 3/4 of its control points
  return (
    `M${MOUTH_LEFT.x},${MOUTH_LEFT.y} C296.5,${c1y} 310.1,${c2y} ${MOUTH_RIGHT.x},${MOUTH_RIGHT.y} ` +
    `C310.1,${c2y + shift} 296.5,${c1y + shift} ${MOUTH_LEFT.x},${MOUTH_LEFT.y} Z`
  )
}

/** A stand-in for speech when the recording could not be measured: syllable-like pulses with pauses. */
function standInSpeech(seconds: number) {
  const syllables = Math.max(0, Math.sin(seconds * 2 * Math.PI * 4.2))
  const phrasing = 0.55 + 0.45 * Math.sin(seconds * 2 * Math.PI * 0.9 + 1)
  const pause = Math.sin(seconds * 2 * Math.PI * 0.35) > 0.85 ? 0.15 : 1
  return Math.min(1, syllables * phrasing * pause * 1.15)
}

interface Targets {
  tilt: number // head rotation, degrees
  smile: number
  browLift: number
  browTilt: number // degrees; positive raises the inner ends (worried look)
  glanceX: number
  glanceY: number
}

function targetsFor(pose: FacePose): Targets {
  switch (pose) {
    case 'listening':
      return { tilt: 2.5, smile: 1, browLift: 0.8, browTilt: 0, glanceX: 0, glanceY: 0 }
    case 'thinking':
      return { tilt: -1.5, smile: 0.8, browLift: 1.5, browTilt: 0, glanceX: 5.5, glanceY: -5 }
    case 'happy':
      return { tilt: 0, smile: 2.1, browLift: 3, browTilt: 0, glanceX: 0, glanceY: 0 }
    case 'concerned':
      return { tilt: 1.5, smile: 0.55, browLift: 1, browTilt: 12, glanceX: 0, glanceY: 0 }
    default:
      return { tilt: 0, smile: 1, browLift: 0, browTilt: 0, glanceX: 0, glanceY: 0 }
  }
}

export function AvatarFace({ pose }: { pose: FacePose }) {
  const reduceMotion = useReducedMotion()
  const poseRef = useRef(pose)
  poseRef.current = pose
  const reduceRef = useRef(reduceMotion)
  reduceRef.current = reduceMotion

  const head = useRef<SVGGElement>(null)
  const mouth = useRef<SVGPathElement>(null)
  const leftPupil = useRef<SVGEllipseElement>(null)
  const rightPupil = useRef<SVGEllipseElement>(null)
  const leftBrow = useRef<SVGPathElement>(null)
  const rightBrow = useRef<SVGPathElement>(null)

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    const start = last
    let nextBlinkAt = last + 1800 + Math.random() * 2500
    let blinkStartedAt = -1
    const cur = { open: 0, tilt: 0, smile: 1, browLift: 0, browTilt: 0, glanceX: 0, glanceY: 0 }

    const ease = (from: number, to: number, dt: number, seconds: number) => from + (to - from) * (1 - Math.exp(-dt / seconds))

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const seconds = (now - start) / 1000
      const still = !!reduceRef.current
      const pose = poseRef.current
      const t = targetsFor(pose)

      // --- mouth: the voice if one is playing (also during Replay), else a stand-in while the pose says speaking
      const voice = getVoiceNow()
      let level = 0
      if (voice.kind === 'real') level = voice.level
      else if (pose === 'speaking') level = standInSpeech(seconds)
      const wanted = Math.pow(Math.max(0, (level - 0.1) / 0.9), 0.85)
      cur.open = ease(cur.open, wanted, dt, wanted > cur.open ? 0.03 : 0.07)

      // --- expression
      cur.tilt = ease(cur.tilt, still ? 0 : t.tilt, dt, 0.5)
      cur.smile = ease(cur.smile, t.smile, dt, 0.25)
      cur.browLift = ease(cur.browLift, t.browLift, dt, 0.25)
      cur.browTilt = ease(cur.browTilt, t.browTilt, dt, 0.25)
      cur.glanceX = ease(cur.glanceX, still ? 0 : t.glanceX, dt, 0.2)
      cur.glanceY = ease(cur.glanceY, still ? 0 : t.glanceY, dt, 0.2)

      // --- blinking
      let eyeOpen = 1
      if (blinkStartedAt < 0 && now >= nextBlinkAt) blinkStartedAt = now
      if (blinkStartedAt >= 0) {
        const p = (now - blinkStartedAt) / 160
        if (p >= 1) {
          blinkStartedAt = -1
          nextBlinkAt = now + 2200 + Math.random() * 3200
        } else {
          eyeOpen = 1 - 0.92 * Math.sin(Math.PI * p)
        }
      }

      // --- apply
      const sway = still ? 0 : Math.sin(seconds * 0.9) * 0.5
      const talk = pose === 'speaking' || voice.kind === 'real'
      const bob = still ? 0 : -cur.open * 1.6 + Math.sin(seconds * 1.7) * 0.35
      const nod = still || !talk ? 0 : Math.sin(seconds * 1.3) * 0.8
      head.current?.setAttribute('transform', `translate(0 ${bob.toFixed(2)}) rotate(${(cur.tilt + sway + nod).toFixed(2)} ${HEAD_PIVOT})`)
      mouth.current?.setAttribute('d', mouthPath(cur.smile, cur.open * MAX_OPEN))
      const pupil = (el: SVGEllipseElement | null, eye: { x: number; y: number }) =>
        el?.setAttribute(
          'transform',
          `translate(${cur.glanceX.toFixed(2)} ${cur.glanceY.toFixed(2)}) translate(${eye.x} ${eye.y}) scale(1 ${eyeOpen.toFixed(3)}) translate(${-eye.x} ${-eye.y})`,
        )
      pupil(leftPupil.current, LEFT_EYE)
      pupil(rightPupil.current, RIGHT_EYE)
      const lift = (-cur.browLift).toFixed(2)
      // Left brow runs from 243.8 to 261.6 (inner end on the right); the right brow mirrors it.
      leftBrow.current?.setAttribute('transform', `translate(0 ${lift}) rotate(${(-cur.browTilt).toFixed(2)} 252.7 292)`)
      rightBrow.current?.setAttribute('transform', `translate(0 ${lift}) rotate(${cur.browTilt.toFixed(2)} 356.7 292)`)

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <svg viewBox="0 0 600 600" className="conv-avatar-face" aria-hidden="true" focusable="false">
      <g ref={head}>
        <path
          fill={HAIR}
          d="M442.4,422.7c-.3,6.7,4.1,12.5,7.7,18.2,9.5,15.4,13.5,34.1,11.2,52.1-.2,1.9-.7,4.1-2.2,5.4-2.2,1.8-5.5,1-8.1,0-38.2-13.5-97.7-32.4-137-42.1-37.6-9.2-43.7,31.9-86,11-4.3-2.2-8.3,5.3-13.1,5.6-7.9.5-14.5-5.8-22-8.4-27.2-9.7-52.5,30.1-80.6,23.2,22.1-28.4,31.6-66.3,25.5-101.9-2.3-13.2-6.4-27.8.6-39.3,3.1-5,8-8.7,12.2-12.9,18.2-18.3,22.7-45.9,24.6-71.6,1.9-25.8,2.5-52.9,15.6-75.1,22-37.1,62.7-41.7,101.6-43.7-6.8-5.7-11-13.6-11-22.3,0-17.4,17-31.5,38-31.5s38,14.1,38,31.5-9.3,24-22.6,28.9c19.7,7.2,37.9,19.2,56.1,30.9,15.7,10.2,31.3,22.2,39.1,39.3,4.8,10.4,6.3,22,9.6,33.1,5.6,18.8,16.5,35.6,25.1,53.3s15.1,37.5,11.2,56.8c-3.3,16.4-13.6,30.4-24.5,43.1C447.2,411.1,442.7,416.3,442.4,422.7Z"
        />
        <path
          fill={SKIN}
          d="M416.4,336.8c-5,5.9-14.2,8.3-20.9,5.4s-.6,0-.6.4c-7,44.3-37.8,73.9-62.5,88.8-17.6,10.6-39.6,10.6-57.2,0-24.8-14.9-55.7-44.6-62.6-89.2,0-.3-.4-.5-.6-.3-6.8,3.4-16.6,1-21.8-5.1-6.4-7.6-7.3-18.5-6.6-28.4.5-6.7,2.4-14.4,8.6-16.9,5-1.9,10.8.7,14.2,4.8,2.5,3,4,6.5,5.1,10.2s.8.4.9-.1c9.1-61.3,66.4-67,85.9-104.7,2.3-4.4,8.6-4.4,10.9,0,19.4,37.3,75.7,43.3,85.7,102.8,0,.5.7.6.8.1,1.1-3,2.5-5.8,4.5-8.3,3.4-4.1,9.2-6.7,14.2-4.8,6.2,2.5,8.1,10.2,8.6,16.9C423.8,318.3,422.9,329.2,416.4,336.8Z"
        />
        <ellipse ref={leftPupil} cx={LEFT_EYE.x} cy={LEFT_EYE.y} rx="8" ry="7.3" fill={INK} />
        <path ref={leftBrow} d="M243.8,294.4c4.8-4.1,11.6-5.8,17.8-4.5" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        <ellipse ref={rightPupil} cx={RIGHT_EYE.x} cy={RIGHT_EYE.y} rx="8" ry="7.3" fill={INK} />
        <path ref={rightBrow} d="M365.6,294.4c-4.8-4.1-11.6-5.8-17.8-4.5" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        <path d="M301.2,337.3l-3.3,14.6c-.3,1.2.3,2.3,1.5,3l3.4,1.8" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        <path
          ref={mouth}
          d={mouthPath(1, 0)}
          fill={MOUTH_INSIDE}
          stroke={INK}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          fill={INK}
          d="M347.8,272.1c-14.6,0-27.4,8.2-34,20.2l.2-1.9c-7.7-.8-15.5-.8-23.2-.1-6.9-10.9-19-18.2-32.8-18.2-21.4,0-38.9,17.4-38.9,38.9s17.5,38.8,38.9,38.8,38.8-17.4,38.8-38.8-1.2-11.1-3.4-15.9c6.3-.5,12.6-.4,18.9.2-2.1,4.8-3.3,10.1-3.3,15.7,0,21.4,17.4,38.8,38.8,38.8s38.8-17.4,38.8-38.8S369.2,272.1,347.8,272.1ZM258,344.8c-18.7,0-33.9-15.2-33.9-33.8s15.2-33.9,33.9-33.9,33.8,15.2,33.8,33.9S276.6,344.8,258,344.8ZM347.8,344.8c-18.6,0-33.8-15.2-33.8-33.8s15.2-33.9,33.8-33.9,33.8,15.2,33.8,33.9S366.5,344.8,347.8,344.8Z"
        />
      </g>
    </svg>
  )
}
