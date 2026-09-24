/**
 * Named experimental bots, so the arena can seat one by name (`--seats exp:<name>`).
 *
 * The spec 2026-09-23 rev 3 pre-registers a small family of candidates (C1a, C1b, C2a, ...); each
 * is registered here the moment it exists, so a gate run names exactly the configuration it
 * measured and a shard process builds the identical bot from the same string.
 */
import type { Bot } from './bot.js'

export const EXPERIMENTS: Readonly<Record<string, () => Bot>> = {}
