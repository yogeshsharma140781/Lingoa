import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

export interface AvatarProps {
  /** Solid ring while the AI speaks, dashed otherwise. */
  ring: 'solid' | 'dashed'
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
export function Avatar({ ring, name, renderInner, tappable = false, onTap, tapLabel = 'Tap to continue' }: AvatarProps) {
  const reduceMotion = useReducedMotion()
  const solid = ring === 'solid'

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
        animate={solid && !reduceMotion ? { scale: [1, 1.025, 1] } : { scale: 1 }}
        transition={solid && !reduceMotion ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.15 }}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={solid ? 56 : 57}
          fill="none"
          stroke="#c4c4c4"
          strokeWidth={solid ? 8 : 4}
          strokeLinecap="round"
          strokeDasharray={solid ? undefined : '7 6'}
        />
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
