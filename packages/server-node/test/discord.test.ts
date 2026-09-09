import { describe, expect, it, vi } from 'vitest'

import { DiscordBot } from '../src/discord.js'

const TOKEN = 'bot-token-secret'
const GUILD = 'guild-1'

function fakeFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return vi.fn(async (url: unknown, init?: RequestInit) => handler(String(url), init)) as unknown as typeof fetch
}

function member(id: string, opts: { username?: string; global_name?: string | null; nick?: string | null } = {}) {
  return {
    nick: opts.nick ?? null,
    user: { id, username: opts.username ?? `user${id}`, global_name: opts.global_name ?? null },
  }
}

describe('DiscordBot.resolveMember', () => {
  it('resolves an exact case-insensitive username match', async () => {
    const fetchFn = fakeFetch((url) => {
      expect(url).toContain('/guilds/guild-1/members/search')
      expect(url).toContain('query=Brian')
      return new Response(JSON.stringify([member('1', { username: 'brian' }), member('2', { username: 'other' })]), {
        status: 200,
      })
    })
    const bot = new DiscordBot({ token: TOKEN, guildId: GUILD, fetch: fetchFn })
    await expect(bot.resolveMember('Brian')).resolves.toEqual({ id: '1', username: 'brian' })
  })

  it('matches case-insensitively on global_name', async () => {
    const fetchFn = fakeFetch(
      () => new Response(JSON.stringify([member('1', { username: 'xyz', global_name: 'Brian Smith' })]), { status: 200 }),
    )
    const bot = new DiscordBot({ token: TOKEN, guildId: GUILD, fetch: fetchFn })
    await expect(bot.resolveMember('brian smith')).resolves.toEqual({ id: '1', username: 'xyz' })
  })

  it('returns undefined on two matches', async () => {
    const fetchFn = fakeFetch(
      () =>
        new Response(JSON.stringify([member('1', { username: 'brian' }), member('2', { nick: 'Brian' })]), {
          status: 200,
        }),
    )
    const bot = new DiscordBot({ token: TOKEN, guildId: GUILD, fetch: fetchFn })
    await expect(bot.resolveMember('Brian')).resolves.toBeUndefined()
  })

  it('returns undefined on a non-2xx response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchFn = fakeFetch(() => new Response(null, { status: 403 }))
    const bot = new DiscordBot({ token: TOKEN, guildId: GUILD, fetch: fetchFn })
    await expect(bot.resolveMember('Brian')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls.some((c) => String(c.join(' ')).includes(TOKEN))).toBe(false)
    warn.mockRestore()
  })
})

describe('DiscordBot.member', () => {
  it('fetches a single guild member by id', async () => {
    const fetchFn = fakeFetch((url, init) => {
      expect(url).toBe('https://discord.com/api/v10/guilds/guild-1/members/42')
      expect((init?.headers as Record<string, string>)['authorization']).toBe(`Bot ${TOKEN}`)
      return new Response(JSON.stringify(member('42', { username: 'brian' })), { status: 200 })
    })
    const bot = new DiscordBot({ token: TOKEN, guildId: GUILD, fetch: fetchFn })
    await expect(bot.member('42')).resolves.toEqual({ id: '42', username: 'brian' })
  })
})

describe('DiscordBot.postMessage', () => {
  it('posts with the right headers, body and locked-down mentions', async () => {
    let capturedInit: RequestInit | undefined
    const fetchFn = fakeFetch((url, init) => {
      expect(url).toBe('https://discord.com/api/v10/channels/chan-1/messages')
      capturedInit = init
      return new Response(null, { status: 200 })
    })
    const bot = new DiscordBot({ token: TOKEN, guildId: GUILD, fetch: fetchFn })
    await bot.postMessage('chan-1', { content: 'hi <@1>', mentions: ['1'] })
    expect((capturedInit?.headers as Record<string, string>)['authorization']).toBe(`Bot ${TOKEN}`)
    const body = JSON.parse(capturedInit!.body as string) as {
      content: string
      allowed_mentions: { parse: string[]; users: string[] }
    }
    expect(body.content).toBe('hi <@1>')
    expect(body.allowed_mentions).toEqual({ parse: [], users: ['1'] })
  })

  it('throws on a non-2xx response', async () => {
    const fetchFn = fakeFetch(() => new Response(null, { status: 500 }))
    const bot = new DiscordBot({ token: TOKEN, guildId: GUILD, fetch: fetchFn })
    await expect(bot.postMessage('chan-1', { content: 'x', mentions: [] })).rejects.toThrow()
  })
})
