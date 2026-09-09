import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DiscordBot } from './discord.js'
import { EngineGate } from './gate.js'
import { Notifier } from './notify.js'
import { createArcsServer } from './server.js'
import { SqliteStore } from './sqlite-store.js'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env['PORT'] ?? 3070)
const DATABASE_PATH = process.env['DATABASE_PATH'] ?? resolve(here, '../data/arcs.db')
const STATIC_DIR = process.env['STATIC_DIR'] ?? resolve(here, '../../../apps/web/dist')
const PUBLIC_ORIGIN = process.env['PUBLIC_ORIGIN'] ?? `http://localhost:${PORT}`
const BOT_PACE_MS = Number(process.env['BOT_PACE_MS'] ?? 1000)
const DISCORD_BOT_TOKEN = process.env['DISCORD_BOT_TOKEN'] || undefined
const DISCORD_GUILD_ID = process.env['DISCORD_GUILD_ID'] || undefined
const DISCORD_CHANNEL_ID = process.env['DISCORD_CHANNEL_ID'] || undefined

process.on('uncaughtException', (e) => console.error('[fatal]', e))
process.on('unhandledRejection', (e) => console.error('[unhandled]', e))

mkdirSync(dirname(DATABASE_PATH), { recursive: true })
const store = new SqliteStore(DATABASE_PATH)

const bot =
  DISCORD_BOT_TOKEN !== undefined && DISCORD_GUILD_ID !== undefined
    ? new DiscordBot({ token: DISCORD_BOT_TOKEN, guildId: DISCORD_GUILD_ID })
    : undefined

const discordStatus =
  bot === undefined ? 'off' : DISCORD_CHANNEL_ID !== undefined ? 'lookup+channel' : 'lookup'

const notifier = new Notifier(store, {
  publicOrigin: PUBLIC_ORIGIN,
  ...(bot !== undefined && DISCORD_CHANNEL_ID !== undefined
    ? { fallbackChannel: { channelId: DISCORD_CHANNEL_ID, bot } }
    : {}),
})
const gate = new EngineGate(store, { pace: BOT_PACE_MS, onSettled: (s) => void notifier.onSettled(s) })
const server = createArcsServer({
  api: { store, gate, ...(bot === undefined ? {} : { bot }) },
  staticDir: STATIC_DIR,
})

void gate.resumeAll()
server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `arcs server on :${PORT}  db=${DATABASE_PATH}  static=${STATIC_DIR}  origin=${PUBLIC_ORIGIN}  discord=${discordStatus}`,
  )
})

const stop = (): void => {
  server.close(() => {
    store.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
