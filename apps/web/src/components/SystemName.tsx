/**
 * A system, written the way the board writes it.
 *
 * The map does not print "2-Hex" anywhere. It prints a numeral and then the cluster's symbol — a
 * four-pointed star, an arrowhead, a crescent, a hexagon — on the region itself and on the little
 * tag beside every planet. So a log that says "2-Hex" is asking the reader to translate: find the
 * word, remember which shape it means, then find that shape on the board. Printing the shape skips
 * the middle step, and a row that names two systems ("moved 2 ships 1-Gate → 1-Arrow") becomes
 * something the eye can match against the map without reading it as a sentence at all.
 *
 * The glyphs are drawn here rather than sliced out of the map art for the reason the rest of the
 * app's chrome is drawn: they have to sit in a line of 11px text, take the color of the text around
 * them (including the blue the log's system marks light up in), and stay crisp at whatever size the
 * row ends up. Four short paths in a shared viewBox do all of that; four `<img>`s would do none of
 * it. They are traced from `map-no-slots.webp` — the shapes, not the printing, so no texture and no
 * bevel.
 *
 * The word survives in two places, which is the whole accessibility story: the symbol's name is on
 * the glyph itself, so the row still reads aloud as "two hex", and the full id is the span's
 * `title`, so a reader who is unsure what a shape means can point at it. Nothing loses a word.
 */

/**
 * The four map symbols as paths in a 100×100 box, filled with `currentColor`.
 *
 * Sized so each one carries about the same amount of ink: a hexagon that filled its box the way the
 * arrowhead does would read as noticeably heavier than its neighbours in a column of them, which is
 * the failure mode of every icon set drawn one icon at a time.
 */
const GLYPH: Readonly<Record<string, string>> = {
  // Four points to the corners with the sides drawn back through the middle — the gate's pinch.
  Gate: 'M6,6 Q50,42 94,6 Q58,50 94,94 Q50,58 6,94 Q42,50 6,6 Z',
  // A delta with its base notched, so it reads as an arrowhead rather than as a triangle.
  Arrow: 'M50,4 L94,96 L50,60 L6,96 Z',
  // Two arcs: the disc, and a wider one swung through it from horn to horn.
  Crescent: 'M66,8 A44,44 0 1,0 66,92 A48,48 0 0,1 66,8 Z',
  // Flat-topped, points left and right, the way the tags on the map print it.
  Hex: 'M8,50 L31,11 L69,11 L92,50 L69,89 L31,89 Z',
}

/** `2-Hex` → `2` and `Hex`, or null for anything not shaped like a system id. */
function split(id: string): { cluster: string; symbol: string } | null {
  const m = /^(\d+)-(.+)$/.exec(id)
  if (m === null || GLYPH[m[2]!] === undefined) return null
  return { cluster: m[1]!, symbol: m[2]! }
}

/**
 * One system name: the cluster number, then its symbol.
 *
 * Falls back to the plain text when the id is not one this knows how to draw — the same "leave it
 * alone" fallback `log-format.ts` takes everywhere else, and for the same reason. A system the map
 * gains before this file hears about it should cost a glyph, never a word.
 */
export function SystemName({ id, className }: { id: string; className?: string }): JSX.Element {
  const parts = split(id)
  if (parts === null) return <span className={className}>{id}</span>
  return (
    <span className={className} title={id}>
      {parts.cluster}
      <svg className="sys-glyph" viewBox="0 0 100 100" role="img" aria-label={parts.symbol} focusable="false">
        <path d={GLYPH[parts.symbol]!} />
      </svg>
    </span>
  )
}
