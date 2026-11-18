import type { ConversationState } from '../stateMachine'
import type { TurnSnapshot } from '../turnTaking'

/** Dev-only: the current state and the running turn-taking timers. */
export function DebugOverlay({ state, snapshot }: { state: ConversationState; snapshot?: TurnSnapshot | null }) {
  if (!import.meta.env.DEV) return null
  const f = (n: number | null | undefined) => (n == null ? '-' : n.toFixed(1) + 's')
  return (
    <div className="conv-debug" aria-hidden="true">
      {`${state.name}${state.name === 'feedback' ? ' (' + state.level + ')' : ''}`}
      {snapshot
        ? `\nmic ${f(snapshot.sinceMicOpen)} · silence ${f(snapshot.silence)}/${f(snapshot.endThreshold)} · speech ${snapshot.speechStarted ? 'yes' : 'no'}`
        : ''}
    </div>
  )
}
