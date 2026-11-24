// Dev-only gallery: every conversation state with mock data, so each can be compared
// with the design. Open the dev server at  /?conversation-gallery
// Click through the real state machine, or jump straight to any state.

import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_TURN_CONFIG, PERSONA_NAMES } from '../config'
import { initialState, transition, type ConversationEvent, type ConversationState } from '../stateMachine'
import type { AiLine, Evaluation, Hints } from '../types'
import { ConversationView, type PlayTarget } from './ConversationView'
import { DebugOverlay } from './DebugOverlay'
import { SettingsSheet } from './SettingsSheet'
import { TranscriptSheet } from './TranscriptSheet'

const AI_LINES: Record<string, AiLine> = {
  short: { text: 'Goedemorgen! Wat mag het zijn?', translation: 'Good morning! What can I get you?' },
  medium: { text: 'Goedemorgen! Welkom in ons café. Wat zou je graag willen bestellen vandaag?', translation: 'Good morning! Welcome to our café. What would you like to order today?' },
  long: { text: 'Goedemorgen en welkom in ons café! We hebben vandaag verse koffie, thee en lekkere appeltaart. Wat zou je willen bestellen?', translation: 'Good morning and welcome to our café! Today we have fresh coffee, tea and delicious apple pie. What would you like to order?' },
  xlong: { text: 'Goedemorgen en welkom in ons café! Vandaag hebben we verse koffie, thee, warme chocolademelk en lekkere appeltaart, en de soep van de dag is tomatensoep met balletjes. Wat zou je willen bestellen, en wil je het hier opeten of meenemen?', translation: 'Good morning and welcome! Today we have fresh coffee, tea, hot chocolate and apple pie, and the soup of the day is tomato soup with meatballs. What would you like to order, and will you eat here or take away?' },
}
const AI_LINE = AI_LINES.short
const HINTS: Hints = { answer: 'Mag ik een cappuccino, alsjeblieft?', stall: 'Ik heb nog even tijd nodig.' }

const EVALUATIONS: Record<'excellent' | 'good' | 'almost' | 'retry', Evaluation> = {
  excellent: { transcript: 'Mag ik een cappuccino, alsjeblieft?', level: 'excellent', reaction: 'Uitstekend!', alternative: null, changedWords: [] },
  good: { transcript: 'Mag ik cappuccino alsjeblieft?', level: 'good', reaction: 'Goed gedaan!', alternative: 'Mag ik een cappuccino, alsjeblieft?', changedWords: ['een'] },
  almost: { transcript: 'Ik wil cappuccino hebben', level: 'almost', reaction: 'Bijna!', alternative: 'Ik wil graag een cappuccino hebben.', changedWords: ['graag', 'een'] },
  retry: { transcript: 'Mag ik… eh… cap', level: 'retry', reaction: 'Probeer het nog eens', alternative: null, changedWords: [] },
}

const JUMPS: Array<{ label: string; state: ConversationState; wrapKind?: 'switch' | 'end' }> = [
  { label: 'aiSpeaking', state: { name: 'aiSpeaking' } },
  { label: 'userListening', state: { name: 'userListening' } },
  { label: 'userSpeaking', state: { name: 'userSpeaking' } },
  { label: 'userWaiting', state: { name: 'userWaiting' } },
  { label: 'hintShown', state: { name: 'hintShown' } },
  { label: 'resting', state: { name: 'resting' } },
  { label: 'processing', state: { name: 'processing' } },
  { label: 'feedback · excellent', state: { name: 'feedback', level: 'excellent' } },
  { label: 'feedback · good', state: { name: 'feedback', level: 'good' } },
  { label: 'feedback · almost', state: { name: 'feedback', level: 'almost' } },
  { label: 'feedback · retry', state: { name: 'feedback', level: 'retry' } },
  { label: 'wrapOffer · switch', state: { name: 'wrapOffer' } },
  { label: 'wrapOffer · end', state: { name: 'wrapOffer' }, wrapKind: 'end' },
]

const SIZES: Array<{ label: string; w: number; h: number }> = [
  { label: 'iPhone 17 Pro 402×874', w: 402, h: 874 },
  { label: 'Smallest 375×667', w: 375, h: 667 },
  { label: 'Largest 440×956', w: 440, h: 956 },
]

export default function ConversationGallery() {
  const [state, setState] = useState<ConversationState>({ name: 'userListening' })
  const [showTranslation, setShowTranslation] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [soundOn, setSoundOn] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [playing, setPlaying] = useState<PlayTarget | null>(null)
  const [size, setSize] = useState(SIZES[0])
  const [textScale, setTextScale] = useState(100)
  const [debug, setDebug] = useState(true)
  const [level, setLevel] = useState(0.5)
  const [animateMic, setAnimateMic] = useState(true)
  const [wrapKind, setWrapKind] = useState<'switch' | 'end'>('switch')
  const [aiLen, setAiLen] = useState<keyof typeof AI_LINES>('short')

  const fire = (event: ConversationEvent) => setState((s) => transition(s, event))

  // Fake mic level so the waveform moves.
  useEffect(() => {
    if (!animateMic) return
    const id = setInterval(() => setLevel(0.2 + Math.random() * 0.8), 120)
    return () => clearInterval(id)
  }, [animateMic])

  const evaluation = useMemo(
    () => (state.name === 'feedback' ? EVALUATIONS[state.level] : null),
    [state],
  )

  const play = (target: PlayTarget) => {
    setPlaying(target)
    setTimeout(() => setPlaying(null), 1500)
  }

  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, alignItems: 'flex-start', background: '#e8e8e8', minHeight: '100vh', height: 'auto', overflow: 'auto', color: '#111', fontFamily: 'system-ui' }}>
      <div style={{ width: 230, flexShrink: 0, fontSize: 13 }}>
        <h3 style={{ margin: '0 0 8px' }}>Conversation states</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {JUMPS.map((j) => {
            const on = j.state.name === state.name && (j.state.name !== 'feedback' || (state.name === 'feedback' && j.state.level === state.level))
            return (
              <button key={j.label} onClick={() => { setState(j.state); if (j.state.name === 'wrapOffer') setWrapKind(j.wrapKind ?? 'switch') }} style={{ textAlign: 'left', padding: '6px 10px', borderRadius: 6, border: '1px solid #bbb', background: on ? '#111' : '#fff', color: on ? '#fff' : '#111', cursor: 'pointer' }}>
                {j.label}
              </button>
            )
          })}
        </div>
        <h3 style={{ margin: '16px 0 8px' }}>Device</h3>
        {SIZES.map((s) => (
          <label key={s.label} style={{ display: 'block' }}>
            <input type="radio" checked={size === s} onChange={() => setSize(s)} /> {s.label}
          </label>
        ))}
        <h3 style={{ margin: '16px 0 8px' }}>AI line length</h3>
        {Object.keys(AI_LINES).map((k) => (
          <label key={k} style={{ display: 'block' }}>
            <input type="radio" name="ailen" checked={aiLen === k} onChange={() => setAiLen(k as keyof typeof AI_LINES)} /> {k}
          </label>
        ))}
        <h3 style={{ margin: '16px 0 8px' }}>Text size: {textScale}%</h3>
        <input type="range" min={100} max={200} step={10} value={textScale} onChange={(e) => setTextScale(+e.target.value)} />
        <div style={{ marginTop: 12 }}>
          <label style={{ display: 'block' }}><input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> Debug overlay</label>
          <label style={{ display: 'block' }}><input type="checkbox" checked={animateMic} onChange={(e) => setAnimateMic(e.target.checked)} /> Animate mic level</label>
        </div>
        <p style={{ marginTop: 16, color: '#555' }}>Buttons in the screen drive the real state machine; the list jumps straight to a state. In the live app, "feedback · excellent" moves on by itself after 2 s (no Continue button); here use the list to leave it.</p>
      </div>

      <div
        style={{ position: 'relative', width: size.w, height: size.h, flexShrink: 0, background: '#fff', borderRadius: 36, boxShadow: '0 10px 40px rgba(0,0,0,.25)', overflow: 'hidden', ['--conv-scale' as string]: textScale / 100 }}
        // The real app pads for the notch and home indicator; this frame mimics that.
      >
        <div style={{ position: 'absolute', inset: 0, paddingTop: 47, paddingBottom: 20 }}>
          <ConversationView
            state={state}
            language="nl"
            scenarioTitle="Ordering at a cafe"
            personaName={PERSONA_NAMES.nl}
            aiLine={AI_LINES[aiLen]}
            showTranslation={showTranslation}
            evaluation={evaluation}
            hints={HINTS}
            micLevel={state.name === 'userSpeaking' ? level : state.name === 'userListening' ? level * 0.4 : 0}
            playing={playing}
            showLiveTranscript={DEFAULT_TURN_CONFIG.showLiveTranscript}
            autoContinue={state.name === 'feedback' && state.level === 'excellent'}
            wrapKind={wrapKind}
            goalReached={false}
            onKeepGoing={() => fire({ type: 'KEEP_GOING' })}
            onNewTopic={() => fire({ type: 'NEW_TOPIC' })}
            onClose={() => setState(initialState)}
            onOpenTranscript={() => setSheetOpen(true)}
            onReplay={() => {
              fire({ type: 'AI_AUDIO_STARTED' })
              setState((s) => (s.name === 'aiSpeaking' ? s : { name: 'aiSpeaking' }))
              setTimeout(() => fire({ type: 'AI_AUDIO_ENDED' }), 1500)
            }}
            onToggleTranslate={() => setShowTranslation((v) => !v)}
            onTapAvatar={() => fire({ type: 'TAP_AVATAR' })}
            onShowHint={() => fire({ type: 'SHOW_HINT' })}
            onDone={() => fire({ type: 'TURN_ENDED' })}
            onOpenSettings={() => setSettingsOpen(true)}
            onPlay={play}
            onContinue={() => fire({ type: 'CONTINUE' })}
            onTryAgain={() => fire({ type: 'TRY_AGAIN' })}
            onSkip={() => fire({ type: 'SKIP' })}
          />
          <SettingsSheet open={settingsOpen} soundOn={soundOn} onToggleSound={() => setSoundOn((v) => !v)} onClose={() => setSettingsOpen(false)} />
          <TranscriptSheet
            open={sheetOpen}
            language="nl"
            onClose={() => setSheetOpen(false)}
            messages={[
              { role: 'ai', text: AI_LINE.text },
              { role: 'you', text: 'Goedemorgen, mag ik een cappuccino?' },
              { role: 'ai', text: 'Natuurlijk! Wil je er iets bij?' },
            ]}
          />
        </div>
        {debug && <DebugOverlay state={state} snapshot={{ speechStarted: state.name === 'userSpeaking', sinceMicOpen: 0, silence: null, endThreshold: null }} />}
      </div>
    </div>
  )
}
