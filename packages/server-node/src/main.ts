import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

mkdirSync(dirname(DATABASE_PATH), { recursive: true })
const store = new SqliteStore(DATABASE_PATH)
const notifier = new Notifier(store, { publicOrigin: PUBLIC_ORIGIN })
const gate = new EngineGate(store, { pace: BOT_PACE_MS, onSettled: (s) => void notifier.onSettled(s) })
const server = createArcsServer({ api: { store, gate }, staticDir: STATIC_DIR })

void gate.resumeAll()
server.listen(PORT, '0.0.0.0', () => {
  console.log(`arcs server on :${PORT}  db=${DATABASE_PATH}  static=${STATIC_DIR}  origin=${PUBLIC_ORIGIN}`)
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
