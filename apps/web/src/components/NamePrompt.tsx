import { useState } from 'react'

interface Props {
  faction: string
  onSubmit: (name: string) => Promise<void>
}

/** Asked once, the first time a seat link is opened with no name on the server. */
export function NamePrompt({ faction, onSubmit }: Props): JSX.Element {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= 24

  async function submit(): Promise<void> {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
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
        {error === null ? null : <p className="name-error">{error}</p>}
        <button className="primary" type="submit" disabled={!valid || busy}>
          {busy ? 'Saving…' : 'Sit down'}
        </button>
      </form>
    </div>
  )
}
