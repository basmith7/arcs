/**
 * DeepSeek's chat API (OpenAI-compatible), for the turn catch-up's writer and checker. One POST,
 * no streaming; the reply's `content` only — the models' `reasoning_content` is never used.
 */

export type Chat = (model: string, system: string, user: string, signal: AbortSignal) => Promise<string>

const URL = 'https://api.deepseek.com/chat/completions'

export function deepseekChat(apiKey: string, fetchFn: typeof fetch = fetch): Chat {
  return async (model, system, user, signal) => {
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
        // Reasoning tokens count against this budget; low effort keeps them few and the call fast.
        max_tokens: 2000,
        reasoning_effort: 'low',
      }),
    })
    if (!res.ok) throw new Error(`deepseek ${res.status}`)
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') throw new Error('deepseek: empty reply')
    return content.trim()
  }
}
