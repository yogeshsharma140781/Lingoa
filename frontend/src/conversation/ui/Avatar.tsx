import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'
import { DotRing } from './DotRing'

export interface AvatarProps {
  /** Solid ring while the AI speaks, dashed otherwise. */
  ring: 'solid' | 'dashed'
  /** The microphone is open: the dashed ring turns orange and slowly rotates. */
  listening?: boolean
  /** The character's name (shown inside the placeholder). */
  name: string
  /** What to draw inside the ring. Pass a Rive canvas (or any node) here later; the layout does not change. */
  renderInner?: (props: { name: string; ring: 'solid' | 'dashed' }) => ReactNode
  /** Tapping the avatar does something (resting). */
  tappable?: boolean
  onTap?: () => void
  /** Accessible name for the tap action. */
  tapLabel?: string
}

const SIZE = 120

/** Placeholder avatar: a ring with the name inside. A Rive animation can replace the inside later. */
export function Avatar({ ring, listening = false, name, renderInner, tappable = false, onTap, tapLabel = 'Tap to continue' }: AvatarProps) {
  const reduceMotion = useReducedMotion()
  const solid = ring === 'solid'
  // Orange means something is happening right now: the AI speaking (solid, pulsing) or the mic
  // listening (dashed, rotating). Any other time the dashed ring is a quiet grey.
  const rotating = !solid && listening && !reduceMotion
  const pulsing = solid && !reduceMotion
  const color = solid || listening ? 'var(--brand, #e2601c)' : '#c4c4c4'

  const inner = renderInner ? (
    renderInner({ name, ring })
  ) : (
    <span className="conv-avatar-name conv-serif">{name}</span>
  )

  const body = (
    <>
      <motion.svg
        className="conv-avatar-ring"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
        animate={pulsing ? { scale: [1, 1.07, 1], rotate: 0 } : rotating ? { scale: 1, rotate: 360 } : { scale: 1, rotate: 0 }}
        transition={
          pulsing
            ? { scale: { duration: 1.3, repeat: Infinity, ease: 'easeInOut' } }
            : rotating
              ? { rotate: { duration: 18, repeat: Infinity, ease: 'linear' } }
              : { duration: 0.15 }
        }
      >
        {solid ? (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={56}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
          />
        ) : (
          <DotRing size={SIZE} color={color} fade={listening} />
        )}
      </motion.svg>
      <div className="conv-avatar-inner">{inner}</div>
    </>
  )

  if (tappable) {
    return (
      <button type="button" className="conv-avatar" data-tappable="true" onClick={onTap} aria-label={`${name}. ${tapLabel}`}>
        {body}
      </button>
    )
  }
  return (
    <div className="conv-avatar" role="img" aria-label={name}>
      {body}
    </div>
  )
}
