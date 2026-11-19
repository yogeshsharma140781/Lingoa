import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import './conversation.css'

import { Languages, MessagesSquare, Play, Volume2, X } from 'lucide-react'
import { Fragment, useEffect, useRef } from 'react'
import { REACTION_FALLBACKS } from '../config'
import { describeState, type ConversationState } from '../stateMachine'
import type { AiLine, Evaluation, Hints } from '../types'
import { Avatar, type AvatarProps } from './Avatar'

export type PlayTarget = 'hintAnswer' | 'hintStall' | 'alternative'

export interface ConversationViewProps {
  state: ConversationState
  language: string
  scenarioTitle: string
  personaName: string
  aiLine: AiLine
  showTranslation: boolean
  evaluation?: Evaluation | null
  hints?: Hints | null
  /** Mic level 0..1, drives the waveform. */
  micLevel?: number
  /** Which suggestion or alternative audio is playing right now. */
  playing?: PlayTarget | null
  /** Live transcript text; shown only when `showLiveTranscript` is true. */
  liveTranscript?: string
  showLiveTranscript?: boolean
  /** The feedback moves on by itself: no Continue button. */
  autoContinue?: boolean
  renderAvatarInner?: AvatarProps['renderInner']

  onClose: () => void
  onOpenTranscript: () => void
  onReplay: () => void
  onToggleTranslate: () => void
  onTapAvatar: () => void
  onShowHint: () => void
  onPlay: (target: PlayTarget) => void
  onContinue: () => void
  onTryAgain: () => void
  onSkip: () => void
}

// Bar heights (px) for the waveform at full level; the level scales them.
const BAR_SHAPE = [10, 22, 30, 44, 18, 36, 26, 40, 14]

function Waveform({ level }: { level: number }) {
  const l = Math.min(1, Math.max(0, level))
  return (
    <div className="conv-waveform" aria-hidden="true">
      {BAR_SHAPE.map((h, i) => (
        <i key={i} style={{ height: `${Math.max(6, Math.round(h * (0.25 + 0.75 * l)))}px` }} />
      ))}
    </div>
  )
}

function Dots() {
  return (
    <div className="conv-dots" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  )
}

/** The alternative sentence with the changed words in bold. */
function Alternative({ text, changed, language }: { text: string; changed: string[]; language: string }) {
  const set = new Set(changed.map((w) => w.toLowerCase()))
  const strip = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}'’-]+/gu, '')
  // Chinese and Japanese have no spaces: the server compares them character by character.
  const tokens = language === 'zh' || language === 'ja' ? Array.from(text) : text.split(/(\s+)/)
  return (
    <p className="conv-alt-text">
      {tokens.map((token, i) =>
        /^\s+$/.test(token) ? (
          <Fragment key={i}>{token}</Fragment>
        ) : set.has(strip(token)) ? (
          <b key={i}>{token}</b>
        ) : (
          <Fragment key={i}>{token}</Fragment>
        ),
      )}
    </p>
  )
}

function PlayButton({ label, playing, onClick }: { label: string; playing: boolean; onClick: () => void }) {
  return (
    <button type="button" className="conv-play" data-playing={playing} onClick={onClick} aria-label={label}>
      <Play size={16} fill="currentColor" aria-hidden="true" />
    </button>
  )
}

export function ConversationView(props: ConversationViewProps) {
  const {
    state, language, scenarioTitle, personaName, aiLine, showTranslation, evaluation, hints,
    micLevel = 0, playing = null, liveTranscript = '', showLiveTranscript = false,
  } = props
  const view = describeState(state)
  const level = state.name === 'feedback' ? state.level : null
  const reaction =
    evaluation?.reaction ||
    (level ? (REACTION_FALLBACKS[language] ?? REACTION_FALLBACKS.en)[level] : null)
  const avatarLabel = state.name === 'feedback' ? reaction : view.avatarLabel

  // Move focus to the primary control when feedback appears, so VoiceOver users land on it.
  const continueRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (state.name === 'feedback') continueRef.current?.focus({ preventScroll: true })
  }, [state.name])

  const showAlternative =
    view.showTranscript && !!evaluation?.alternative && (level === 'good' || level === 'almost')

  return (
    <div className="conv-root" data-state={state.name}>
      {/* Tells screen readers what changed. */}
      <div className="sr-only" role="status" aria-live="polite">
        {view.announcement}
        {state.name === 'feedback' && reaction ? `: ${reaction}` : ''}
      </div>

      <header className="conv-header">
        <button type="button" className="conv-icon-btn" onClick={props.onOpenTranscript} aria-label="Open transcript">
          <MessagesSquare size={20} aria-hidden="true" />
        </button>
        <div className="conv-title">{scenarioTitle}</div>
        <button type="button" className="conv-icon-btn" onClick={props.onClose} aria-label="Close conversation">
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      {/* Scrolls only when text is large or the phone is small; header and footer stay put. */}
      <div className="conv-scroll">
      {/* Top half: the AI. Same place in every state. */}
      <div className="conv-avatar-wrap">
        <Avatar
          ring={view.ring}
          listening={view.micOpen}
          name={personaName}
          renderInner={props.renderAvatarInner}
          tappable={view.avatarTappable}
          onTap={props.onTapAvatar}
        />
        <div className="conv-avatar-label">{avatarLabel}</div>
      </div>

      <div className="conv-ai">
        <p className="conv-ai-line conv-serif" data-dimmed={view.aiLineDimmed} lang={language}>
          {aiLine.text}
        </p>
        <div className="conv-actions">
          <button type="button" className="conv-pill-hit" onClick={props.onReplay} aria-label="Replay what the AI said">
            <span className="conv-pill"><Volume2 size={14} aria-hidden="true" />Replay</span>
          </button>
          <button
            type="button"
            className="conv-pill-hit"
            onClick={props.onToggleTranslate}
            aria-pressed={showTranslation}
            aria-label={showTranslation ? 'Hide the English translation' : 'Show the English translation'}
          >
            <span className="conv-pill" data-on={showTranslation}><Languages size={14} aria-hidden="true" />Translate</span>
          </button>
        </div>
        <div className="conv-translation" aria-live="polite">{showTranslation ? aiLine.translation : ''}</div>
      </div>

      {/* Lower half: the learner. */}
      <div className="conv-lower">
        {view.indicator === 'waveform' && (
          <div className="conv-indicator">
            <Waveform level={micLevel} />
            <div className="conv-caption">{view.indicatorCaption}</div>
          </div>
        )}
        {view.indicator === 'dots' && (
          <div className="conv-indicator">
            <Dots />
            <div className="conv-caption">{view.indicatorCaption}</div>
          </div>
        )}
        {view.indicator === 'processing' && (
          <div className="conv-indicator">
            <div className="conv-processing" aria-hidden="true"><i /><i /><i /></div>
            <div className="conv-caption">{view.indicatorCaption}</div>
          </div>
        )}

        {showLiveTranscript && liveTranscript && view.micOpen && (
          <p className="conv-said conv-serif" style={{ marginTop: 10 }} lang={language}>{liveTranscript}</p>
        )}

        {view.showHintButton && (
          <button type="button" className="conv-hint-btn" onClick={props.onShowHint}>Show a hint</button>
        )}

        {view.showHintCard && hints && (
          <section className="conv-card" aria-label="Hints">
            <h2 className="conv-card-title" style={{ fontWeight: 400 }}>You could say either of these:</h2>
            <div className="conv-suggestion">
              <p lang={language}>{hints.answer}</p>
              <PlayButton label={`Hear: ${hints.answer}`} playing={playing === 'hintAnswer'} onClick={() => props.onPlay('hintAnswer')} />
            </div>
            <div className="conv-suggestion">
              <p lang={language}>{hints.stall}</p>
              <PlayButton label={`Hear: ${hints.stall}`} playing={playing === 'hintStall'} onClick={() => props.onPlay('hintStall')} />
            </div>
          </section>
        )}

        {view.showTranscript && evaluation && evaluation.transcript && (
          <>
            <div className="conv-said-label">YOU SAID</div>
            <p className="conv-said conv-serif" lang={language}>{evaluation.transcript}</p>
          </>
        )}

        {showAlternative && evaluation?.alternative && (
          <section className="conv-card conv-alt" aria-label="Better alternative">
            <h2 className="conv-card-title" style={{ fontWeight: 400 }}>Better alternative</h2>
            <div className="conv-suggestion">
              <div lang={language}><Alternative text={evaluation.alternative} changed={evaluation.changedWords} language={language} /></div>
              <PlayButton label="Hear the better alternative" playing={playing === 'alternative'} onClick={() => props.onPlay('alternative')} />
            </div>
          </section>
        )}
      </div>
      </div>

      {/* Pinned at the bottom, outside the scroll area. */}
      {((view.showContinue && !props.autoContinue) || view.showRetry) && (
        <div className="conv-footer">
          {view.showContinue && !props.autoContinue && (
            <button ref={continueRef} type="button" className="conv-primary" onClick={props.onContinue}>Continue</button>
          )}
          {view.showRetry && (
            <>
              <button ref={continueRef} type="button" className="conv-primary" onClick={props.onTryAgain}>Try again</button>
              <button type="button" className="conv-text-btn" onClick={props.onSkip}>Skip</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
