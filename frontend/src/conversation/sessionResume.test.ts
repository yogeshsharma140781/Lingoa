import { describe, expect, it } from 'vitest'
import { messagesForResume, withSessionRecovery } from './sessionResume'

const history = [
  { role: 'assistant' as const, content: 'Goedemorgen! Wat mag het zijn?' },
  { role: 'user' as const, content: 'Een koffie, alsjeblieft.' },
  { role: 'assistant' as const, content: 'Met melk?' },
]

describe('messagesForResume', () => {
  it('sends the whole conversation, greeting included', () => {
    expect(messagesForResume(history)).toEqual(history)
  })

  it('leaves out what the learner just said when it is about to be sent with the reply request', () => {
    const withPending = [...history, { role: 'user' as const, content: 'Ja, graag.' }]
    expect(messagesForResume(withPending, 'Ja, graag.')).toEqual(history)
  })

  it('keeps a user message that is not the pending one', () => {
    expect(messagesForResume(history, 'Ja, graag.')).toEqual(history)
  })

  it('drops empty messages', () => {
    expect(messagesForResume([{ role: 'assistant', content: '   ' }, ...history])).toEqual(history)
  })

  it('sends at most the last 40 messages', () => {
    const long = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? ('user' as const) : ('assistant' as const), content: `m${i}` }))
    const sent = messagesForResume(long)
    expect(sent).toHaveLength(40)
    expect(sent[39].content).toBe('m59')
  })
})

describe('withSessionRecovery', () => {
  const reply = (status: number) => ({ status, ok: status < 400 }) as Response

  it('passes a normal answer straight through, without restoring anything', async () => {
    let restores = 0
    const res = await withSessionRecovery(async () => reply(200), async () => (restores++, true))
    expect(res.status).toBe(200)
    expect(restores).toBe(0)
  })

  it('restores the session and asks again when the server does not know it', async () => {
    const statuses = [404, 200]
    let sends = 0
    let restores = 0
    const res = await withSessionRecovery(async () => reply(statuses[sends++]), async () => (restores++, true))
    expect(res.status).toBe(200)
    expect(sends).toBe(2)
    expect(restores).toBe(1)
  })

  it('gives up with the 404 when the session cannot be restored (and does not ask twice)', async () => {
    let sends = 0
    const res = await withSessionRecovery(async () => (sends++, reply(404)), async () => false)
    expect(res.status).toBe(404)
    expect(sends).toBe(1)
  })

  it('asks only one more time even if the second answer is a 404 too', async () => {
    let sends = 0
    const res = await withSessionRecovery(async () => (sends++, reply(404)), async () => true)
    expect(res.status).toBe(404)
    expect(sends).toBe(2)
  })

  it('does not treat other errors as a lost session', async () => {
    let restores = 0
    const res = await withSessionRecovery(async () => reply(500), async () => (restores++, true))
    expect(res.status).toBe(500)
    expect(restores).toBe(0)
  })
})
