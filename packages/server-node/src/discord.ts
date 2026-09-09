/**
 * Thin wrapper around the Discord REST API for the bot ("Pikachu") that already lives on the same
 * server. Used to resolve a claimed seat name to a guild member (so players do not have to paste
 * their Discord user ID) and to post turn pings to a channel when a game has no webhook of its own.
 *
 * Every call is best-effort: a failed lookup returns `undefined` and logs a warning rather than
 * throwing, since a broken Discord integration must never block naming a seat or playing the game.
 * `postMessage` is the one exception — the Notifier already treats a thrown poster as "log and
 * ignore" (notify.ts), so it throws on a non-2xx rather than swallowing it twice.
 */

const API = 'https://discord.com/api/v10'

export interface DiscordMember {
  readonly id: string
  readonly username: string
}

interface DiscordUser {
  readonly id: string
  readonly username: string
  readonly global_name?: string | null
}

interface GuildMember {
  readonly nick?: string | null
  readonly user: DiscordUser
}

export interface DiscordBotOptions {
  readonly token: string
  readonly guildId: string
  readonly fetch?: typeof fetch
}

function matches(member: GuildMember, name: string): boolean {
  const target = name.trim().toLowerCase()
  const candidates = [member.user.username, member.user.global_name ?? undefined, member.nick ?? undefined]
  return candidates.some((c) => c !== undefined && c.trim().toLowerCase() === target)
}

function toMember(member: GuildMember): DiscordMember {
  return { id: member.user.id, username: member.user.username }
}

export class DiscordBot {
  private readonly token: string
  private readonly guildId: string
  private readonly fetch: typeof fetch

  constructor(opts: DiscordBotOptions) {
    this.token = opts.token
    this.guildId = opts.guildId
    this.fetch = opts.fetch ?? fetch
  }

  async resolveMember(name: string): Promise<DiscordMember | undefined> {
    const url = `${API}/guilds/${this.guildId}/members/search?query=${encodeURIComponent(name)}&limit=10`
    const members = await this.getJson<GuildMember[]>(url)
    if (members === undefined) return undefined
    const hits = members.filter((m) => matches(m, name))
    return hits.length === 1 ? toMember(hits[0]!) : undefined
  }

  async member(id: string): Promise<DiscordMember | undefined> {
    const url = `${API}/guilds/${this.guildId}/members/${id}`
    const member = await this.getJson<GuildMember>(url)
    return member === undefined ? undefined : toMember(member)
  }

  async postMessage(channelId: string, message: { content: string; mentions: readonly string[] }): Promise<void> {
    const res = await this.fetch(`${API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bot ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        content: message.content,
        allowed_mentions: { parse: [], users: message.mentions },
      }),
    })
    if (!res.ok) throw new Error(`discord channel post -> ${res.status}`)
  }

  private async getJson<T>(url: string): Promise<T | undefined> {
    let res: Response
    try {
      res = await this.fetch(url, { headers: { authorization: `Bot ${this.token}` } })
    } catch (e) {
      console.warn('[discord] member search failed', (e as Error).message)
      return undefined
    }
    if (!res.ok) {
      console.warn('[discord] member search failed', res.status)
      return undefined
    }
    return (await res.json()) as T
  }
}
