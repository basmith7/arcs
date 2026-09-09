/**
 * Settings: the board and audio controls, and the only dialog here that is not about a decision.
 * When opened from inside a game, `seat` is passed and the seated-player sections (Player,
 * Notifications, Game) render above the board and audio ones; on the title screen, hotseat and for
 * spectators `seat` is omitted and only the board and audio sections show, exactly as before there
 * was a game to be seated in.
 *
 * It wears the console chrome anyway — `.da-backdrop > .da-modal > .da-head`, draggable by the
 * header — because that shape is what a dialog looks like in this app, and a settings panel that
 * invented its own would read as coming from a different program. It is *not* wrapped in
 * `Watching`: a spectator has ears.
 *
 * Escape closes, matching the log drawer. The backdrop closes on a click that started and ended
 * on the backdrop itself, so releasing a slider drag outside the dialog does not dismiss it.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { useModalDrag } from '../modal-drag.js'
import type { GameLink } from '../multiplayer/link.js'
import { setSettings, useSettings } from '../settings.js'
import { GameSection, NotificationsSection, PlayerSection } from './settings-sections.js'

function SliderRow({
  label,
  value,
  onChange,
  disabled = false,
  note,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  note?: string
}): JSX.Element {
  return (
    <label className={`set-row${disabled ? ' off' : ''}`}>
      <span className="set-label">{label}</span>
      <input
        className="set-slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <span className="set-value">{Math.round(value * 100)}%</span>
      {note !== undefined ? <span className="set-note">{note}</span> : null}
    </label>
  )
}

export function SettingsModal({
  onClose,
  seat,
}: {
  onClose: () => void
  seat?: { faction: string; link: GameLink | null }
}): JSX.Element {
  const drag = useModalDrag()
  const settings = useSettings()
  /** Where the press that might close this started — see the note on the backdrop above. */
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className={`da-backdrop${drag.dragged ? ' aside' : ''}`}
      onPointerDown={(e) => void (pressedBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedBackdrop.current) onClose()
      }}
    >
      <div ref={drag.ref} className="da-modal settings-modal" style={drag.style}>
        <div className="da-head" {...drag.handle}>
          <span className="da-title">Settings</span>
          <button className="da-ghost" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        {seat === undefined ? null : (
          <>
            <PlayerSection faction={seat.faction} />
            <NotificationsSection />
            <GameSection faction={seat.faction} link={seat.link} />
          </>
        )}

        <section className="set-section">
          <h3 className="set-heading">Board</h3>
          <SliderRow
            label="Dim map art"
            value={settings.boardDim}
            onChange={(v) => setSettings({ boardDim: v })}
            note="Fades the painted map towards a schematic. Planets, symbols, numbers and the lines that matter stay."
          />
        </section>

        <section className="set-section">
          <h3 className="set-heading">Music</h3>
          <label className="set-row">
            <span className="set-label">Play music</span>
            <input
              className="set-check"
              type="checkbox"
              checked={settings.musicEnabled}
              onChange={(e) => setSettings({ musicEnabled: e.target.checked })}
            />
            <span className="set-value">{settings.musicEnabled ? 'On' : 'Off'}</span>
          </label>
          <SliderRow
            label="Volume"
            value={settings.musicVolume}
            disabled={!settings.musicEnabled}
            onChange={(v) => setSettings({ musicVolume: v })}
          />
        </section>

        <section className="set-section">
          <h3 className="set-heading">Sound effects</h3>
          <SliderRow
            label="Volume"
            value={settings.sfxVolume}
            onChange={(v) => setSettings({ sfxVolume: v })}
            note="Nothing plays sound effects yet — this is remembered for when something does."
          />
        </section>

        <div className="da-actions">
          <span className="da-spacer" />
          <button className="da-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
