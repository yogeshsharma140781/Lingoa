// A ring made of real round dots (not stroked dashes, which come out as little pills).
// `fade` makes the dots grow gradually fainter around the ring, so that when the ring turns
// you can see it turn; an even ring of identical dots looks the same at every angle.

export function DotRing({
  size = 120,
  radius = 57,
  dotRadius = 2.25,
  count = 32,
  color,
  fade = false,
}: {
  size?: number
  radius?: number
  dotRadius?: number
  count?: number
  color: string
  fade?: boolean
}) {
  const c = size / 2
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2
        const opacity = fade ? 0.35 + 0.65 * Math.pow(i / (count - 1), 1.3) : 1
        return (
          <circle
            key={i}
            cx={c + radius * Math.cos(angle)}
            cy={c + radius * Math.sin(angle)}
            r={dotRadius}
            fill={color}
            opacity={opacity}
            style={{ transition: 'fill 200ms ease' }}
          />
        )
      })}
    </g>
  )
}
