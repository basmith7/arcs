/**
 * Thin wrapper around the Discord REST API for the channel bot (Jarvis, the server's admin bot).
 * Used to resolve a claimed seat name to a guild member (so players do not have to paste their
 * Discord user ID) and to post turn pings to the configured channel.
 *
 * Every call is best-effort: a failed lookup returns `undefined` and logs a warning rather than
 * throwing, since a broken Discord integration must never block naming a seat or playing the game.
 * `postMessage` is the one exception — the Notifier already treats a thrown poster as "log and
 * ignore" (notify.ts), so it throws on a non-2xx rather than swallowing it twice.
 */

import type { Embed } from './discord-cards.js'

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

export interface ChannelMessage {
  readonly content: string
  /** User ids the post may ping; every other mention in `content` renders without pinging. */
  readonly mentions: readonly string[]
  readonly embeds?: readonly Embed[]
  /** A button under the message that opens `url`. */
  readonly link?: { readonly label: string; readonly url: string }
}

export interface DiscordBotOptions {
  readonly token: string
  readonly guildId: string
  readonly fetch?: typeof fetch
  /** Per-request timeout in milliseconds. A hung Discord API must never hang a seat claim. */
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5000

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
  private readonly timeoutMs: number

  constructor(opts: DiscordBotOptions) {
    this.token = opts.token
    this.guildId = opts.guildId
    this.fetch = opts.fetch ?? fetch
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async resolveMember(name: string): Promise<DiscordMember | undefined> {
    const url = `${API}/guilds/${this.guildId}/members/search?query=${encodeURIComponent(name)}&limit=10`
    const members = await this.getJson<GuildMember[]>(url, 'member search')
    if (members === undefined) return undefined
    const hits = members.filter((m) => matches(m, name))
    return hits.length === 1 ? toMember(hits[0]!) : undefined
  }

  async member(id: string): Promise<DiscordMember | undefined> {
    const url = `${API}/guilds/${this.guildId}/members/${id}`
    const member = await this.getJson<GuildMember>(url, 'member lookup')
    return member === undefined ? undefined : toMember(member)
  }

  async postMessage(channelId: string, message: ChannelMessage): Promise<void> {
    let res: Response
    try {
      res = await this.fetch(`${API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bot ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          content: message.content,
          allowed_mentions: { parse: [], users: message.mentions },
          ...(message.embeds === undefined ? {} : { embeds: message.embeds }),
          // A link button (style 5): plain bots may post these; they need no interaction handler.
          ...(message.link === undefined
            ? {}
            : { components: [{ type: 1, components: [{ type: 2, style: 5, label: message.link.label, url: message.link.url }] }] }),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      throw new Error(`discord channel post failed: ${(e as Error).message}`)
    }
    if (!res.ok) throw new Error(`discord channel post -> ${res.status}`)
  }

  private async getJson<T>(url: string, label: string): Promise<T | undefined> {
    let res: Response
    try {
      res = await this.fetch(url, {
        headers: { authorization: `Bot ${this.token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      console.warn(`[discord] ${label} failed`, (e as Error).message)
      return undefined
    }
    if (!res.ok) {
      console.warn(`[discord] ${label} failed`, res.status)
      return undefined
    }
    return (await res.json()) as T
  }
}
