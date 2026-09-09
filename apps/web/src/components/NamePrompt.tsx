import { useEffect, useState } from 'react'

import { isValidDiscordId, isValidName } from '../seat-form.js'

interface Props {
  faction: string
  onSubmit: (name: string, discordId?: string) => Promise<void>
  /** Escape dismisses the prompt for the rest of the session; caller decides how to remember that. */
  onDismiss?: () => void
  /** Prefills the form for a seated player reopening the prompt to change their name. */
  initialName?: string
}

/** Asked once, the first time a seat link is opened with no name on the server. */
export function NamePrompt({ faction, onSubmit, onDismiss, initialName }: Props): JSX.Element {
  const [name, setName] = useState(initialName ?? '')
  const [discordId, setDiscordId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()
  const trimmedDiscordId = discordId.trim()
  const validName = isValidName(name)
  const validDiscordId = isValidDiscordId(discordId)
  const valid = validName && validDiscordId

  // Scoped to this component's lifetime, so a stray Escape elsewhere (closing the log, say) never
  // dismisses a prompt that was not on screen to begin with — only mounts while `needsName` is true.
  useEffect(() => {
    if (onDismiss === undefined) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  async function submit(): Promise<void> {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed, trimmedDiscordId.length === 0 ? undefined : trimmedDiscordId)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="name-backdrop" role="dialog" aria-modal="true" aria-labelledby="name-title">
      <form
        className="name-card"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h2 id="name-title">You are {faction}</h2>
        <p>What should the table call you?</p>
        <input
          autoFocus
          maxLength={24}
          value={name}
          placeholder="Your name"
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor="discord-id-input">Discord user ID (optional)</label>
        <input
          id="discord-id-input"
          value={discordId}
          placeholder="123456789012345678 or @mention"
          onChange={(e) => setDiscordId(e.target.value)}
        />
        <p className="name-help">
          Optional. Leave this blank and the table will try to match your name to a member of the
          Discord server; paste your Discord user ID if the tag comes out wrong or missing.
        </p>
        {!validDiscordId ? <p className="name-error">That doesn't look like a Discord user ID</p> : null}
        {error === null ? null : <p className="name-error">{error}</p>}
        <button className="primary" type="submit" disabled={!valid || busy}>
          {busy ? 'Saving…' : 'Sit down'}
        </button>
      </form>
    </div>
  )
}
