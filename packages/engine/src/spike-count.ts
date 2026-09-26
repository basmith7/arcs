/**
 * Call counters for the engine-speed spike (docs/spikes/2026-09-engine-speed.md). Observation only:
 * a few integer increments per call, read by `scripts/spike-game.ts`.
 */
export const SPIKE_COUNTS = { advance: 0, perform: 0, observe: 0, featuresOf: 0, featuresOfUncached: 0, positionalUncached: 0 }
