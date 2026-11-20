// The server keeps conversations in memory, so a restart (every deploy) makes it forget one that is in
// progress. The app has the whole conversation, so it can hand it back and carry on.

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * The conversation to send back to the server.
 * `pendingUserText` is what the learner just said and is about to be sent with the reply request:
 * the server adds that itself, so it is left out here (otherwise it would be in the history twice).
 */
export function messagesForResume(history: HistoryMessage[], pendingUserText?: string): HistoryMessage[] {
  const messages = history
    .map((m) => ({ role: m.role, content: (m.content ?? '').trim() }))
    .filter((m) => m.content.length > 0)
  const last = messages[messages.length - 1]
  if (pendingUserText && last && last.role === 'user' && last.content === pendingUserText.trim()) messages.pop()
  return messages.slice(-40)
}

/**
 * Send a request; if the server says it does not know the session (404), restore the session and
 * send the request once more. Anything else (success, other errors) is returned as it is.
 */
export async function withSessionRecovery(
  send: () => Promise<Response>,
  restore: () => Promise<boolean>,
): Promise<Response> {
  const res = await send()
  if (res.status === 404 && (await restore())) return send()
  return res
}
