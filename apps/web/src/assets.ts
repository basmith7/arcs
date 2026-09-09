/**
 * Build a URL for a file in `public/`, honouring the deployment's base path.
 *
 * **Vite rewrites asset URLs in CSS and in imports; it cannot rewrite a string built at runtime.**
 * So `url('/game-assets/x.webp')` in a stylesheet is corrected at build time, while
 * `` `/game-assets/court/${id}.webp` `` in a component is emitted exactly as written and resolves
 * against the domain root.
 *
 * That difference is invisible in development, where the base path *is* `/` — and it is why the
 * first GitHub Pages deploy served a correct background over an app whose every card, figure, die
 * and setup image 404'd. The site is served from `/open-arcs/`, and only the CSS knew.
 *
 * `import.meta.env.BASE_URL` is whatever the build was configured with, so this is correct in dev,
 * on a project site, and on a host serving from the root.
 */
export function asset(path: string): string {
  // BASE_URL always ends in a slash, so the leading one here would double it.
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}

/**
 * The same art at half size — `scripts/build_small_art.py` writes a `.sm.webp` beside every
 * card image.
 *
 * **Use this for any card the player is looking *at* rather than reading.** The originals are
 * 744x1039 (827x1417 for leaders and fates) and the app draws them at 118x165 in the hand,
 * 98x139 in the court rail, 150 wide in the draft. Loading the full art for those meant one
 * screen decoded ~10 megapixels — about 41 MB of raster — and every repaint resampled bitmaps
 * some twenty times the area that reached the screen. That is what made the hand's hover lift
 * stutter, and it cost the same on every other repaint besides.
 *
 * Half size still has a 2x display covered at each of those sizes. The two places a card is
 * *read* — `CardZoom` and the draft's card reader — scale art up to 900px tall and so keep
 * calling `asset` for the original.
 */
export function smallArt(path: string): string {
  return asset(path.replace(/\.webp$/, '.sm.webp'))
}
