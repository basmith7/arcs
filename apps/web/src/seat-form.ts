/**
 * Validation shared between `NamePrompt` (the first-visit ask) and `SettingsPanel` (editing the
 * same fields later) — one regex and one set of length rules, so the two forms cannot silently
 * drift apart on what counts as a name or a Discord id.
 */

export const DISCORD_ID_RE = /^(<@!?\d{17,20}>|\d{17,20})$/

export const NAME_MAX = 24

export function isValidName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed.length >= 1 && trimmed.length <= NAME_MAX
}

/** Empty is valid here — an optional Discord id field left blank. */
export function isValidDiscordId(id: string): boolean {
  const trimmed = id.trim()
  return trimmed.length === 0 || DISCORD_ID_RE.test(trimmed)
}
