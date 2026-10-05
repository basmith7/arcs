/**
 * DeepSeek's chat API (OpenAI-compatible), for the turn catch-up's writer and checker. One POST,
 * no streaming; the reply's `content` only — the models' `reasoning_content` is never used.
 */

/** `reason`: let the model think first (low effort); off, it answers straight away. */
export type Chat = (
  model: string,
  system: string,
  user: string,
  signal: AbortSignal,
  opts?: { readonly reason?: boolean },
) => Promise<string>

const URL = 'https://api.deepseek.com/chat/completions'

export function deepseekChat(apiKey: string, fetchFn: typeof fetch = fetch): Chat {
  return async (model, system, user, signal, opts = {}) => {
    const res = await fetchFn(URL, {
      method: 'POST',
      signal,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        /*
         * Both models reason by default, and reasoning counts against max_tokens (a 2000 budget
         * once left the checker's reply empty). The catch-up reasons on both calls: without it the
         * checker passed a story that gave the wrong player the initiative and the writer slipped
         * more (2026-10-05 probes). Off stays for callers that want a fast plain answer.
         */
        ...(opts.reason === true
          ? { reasoning_effort: 'low', max_tokens: 8000 }
          : { thinking: { type: 'disabled' }, max_tokens: 1000 }),
      }),
    })
    if (!res.ok) throw new Error(`deepseek ${res.status}`)
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') throw new Error('deepseek: empty reply')
    return content.trim()
  }
}
