/**
 * Articulation-based velocity shaping and metric/humanize offsets.
 *
 * The dynamic level → {velocity, CC11} mapping lives in `dynamicsEnvelope.ts`
 * (the coupled-dynamics system). This module holds the per-note attack-character
 * adjustments layered on top: accents, articulation duration scaling, metric
 * accent, and deterministic velocity/timing humanization.
 */

import type { Markings, TimeSignature } from "@viritura/core";

/**
 * Apply articulation-based velocity adjustments.
 *
 * - accent: +20 (capped at 127)
 * - strongAccent (marcato): +30 (capped at 127)
 * - stress: +15
 * - unstress: −15 (floored at 1)
 * - softAccent: +10
 */
export function applyArticulationVelocity(baseVelocity: number, markings: Markings | undefined): number {
  if (!markings) return baseVelocity;

  let v = baseVelocity;
  if (markings.accent) v += 20;
  if (markings.strongAccent) v += 30;
  if (markings.stress) v += 15;
  if (markings.unstress) v -= 15;
  if (markings.softAccent) v += 10;

  return Math.max(1, Math.min(127, v));
}

/**
 * Compute the duration scaling factor for articulation markings.
 *
 * - staccato: 50% of notated duration
 * - staccatissimo: 25% of notated duration
 * - spiccato: 30% of notated duration
 * - tenuto: 100% of notated duration
 * - default (no marking): 90% (slight separation between notes)
 *
 * standard engraving practice defaults — staccato=50%, staccatissimo=33%,
 * tenuto=100%, default=~90%.
 */
export function articulationDurationScale(markings: Markings | undefined): number {
  if (!markings) return 0.9;
  if (markings.staccatissimo) return 0.25;
  if (markings.spiccato) return 0.3;
  if (markings.staccato) return 0.5;
  if (markings.tenuto) return 1.0;
  return 0.9;
}

// ═══════════════════════════════════════════
// Metric accent — subtle velocity shaping by beat position
// ═══════════════════════════════════════════

/**
 * Maximum velocity offset for metric accent (applied at the strongest beat).
 * Kept small to remain subtle: ±6 on a 0–127 scale (~5%).
 */
const METRIC_ACCENT_RANGE = 6;

/**
 * Compute a metric accent velocity offset for a given beat position.
 *
 * Uses hierarchical subdivision weighting: each time you halve the beat grid,
 * positions that fall on the finer grid get progressively weaker. The result
 * is a signed offset (positive = stronger, negative = weaker) that should be
 * added to the base velocity.
 *
 * For simple meters (2/4, 3/4, 4/4, 2/2, etc.) this produces the natural
 * strong/weak pattern:
 *   4/4: beat 1 strongest, 3 strong, 2 & 4 weak; 8ths alternate, 16ths finer.
 *
 * **Future work (compound / asymmetric meters):**
 * This function currently assumes beats are grouped in powers of 2 from the
 * measure downbeat. For compound meters like 6/8 (2 groups of 3 eighth notes)
 * or 12/8 (4 groups of 3), the strong-beat hierarchy is different — e.g. in
 * 6/8, beat 4 (the dotted-quarter group boundary) should be nearly as strong
 * as beat 1, not weak. Similarly, asymmetric meters like 5/8 (2+3 or 3+2) or
 * 7/8 (2+2+3) have user-defined beat groupings.
 *
 * Once Viritura supports user-configurable beat/beam grouping per time
 * signature (similar to Dorico's beat grouping editor for complex meters),
 * this function should accept the beat group boundaries and compute metric
 * weight relative to each group's downbeat rather than the measure downbeat.
 * The grouping data would define which beats are "strong" within each
 * subdivision group, enabling correct metric accenting for any meter.
 *
 * @param beatOffset - Beat position within the measure (in quarter-note beats, 0-based)
 * @param timeSignature - Active time signature
 * @returns Signed velocity offset to add to base velocity (clamped later)
 */
export function metricAccentOffset(beatOffset: number, timeSignature: TimeSignature): number {
  const measureBeats = (timeSignature.count / timeSignature.unit) * 4;
  if (measureBeats <= 0) return 0;

  // Normalize position to [0, measureBeats)
  const pos = ((beatOffset % measureBeats) + measureBeats) % measureBeats;

  // Compute metric weight by checking which subdivision level this beat falls on.
  // Level 0 = downbeat (pos ≈ 0), highest weight.
  // Level 1 = falls on half-measure grid but not downbeat.
  // Level 2 = falls on quarter-measure grid but not half, etc.
  // Weight decreases by 1 per level. Maximum depth = 5 (down to 64th-note grid).
  const MAX_DEPTH = 5;
  let level = MAX_DEPTH; // default: finest subdivision

  // Check from coarsest to finest grid
  let grid = measureBeats; // full measure
  for (let d = 0; d <= MAX_DEPTH; d++) {
    // Check if pos falls on this grid (within tolerance for floating-point)
    const remainder = pos % grid;
    if (remainder < 1e-6 || grid - remainder < 1e-6) {
      level = d;
      break;
    }
    grid /= 2;
  }

  // Map level to velocity offset:
  // level 0 (downbeat)        → +RANGE
  // level MAX_DEPTH (finest)  → -RANGE
  // Linear interpolation between them
  const normalized = level / MAX_DEPTH; // 0 = strongest, 1 = weakest
  return Math.round(METRIC_ACCENT_RANGE * (1 - 2 * normalized));
}

// ═══════════════════════════════════════════
// Velocity humanization — deterministic per-note jitter
// ═══════════════════════════════════════════

/**
 * Maximum velocity jitter for humanization.
 *
 * Kept at ±2 to preserve the metric accent hierarchy:
 *   Metric accent offsets: +6, +4, +1, -1, -4, -6 (levels 0–5)
 *   Minimum gap between non-adjacent levels: 5 (downbeat +6 vs quarter +1)
 *   With ±2 jitter, downbeat worst-case (+4) > quarter best-case (+3) ✓
 *
 * Only adjacent subdivision levels (e.g. downbeat vs half-measure) can
 * occasionally overlap, which is musically natural — beat 3 in 4/4 is
 * nearly as strong as beat 1 in real performance.
 */
const HUMANIZE_MAX = 2;

/**
 * Compute a deterministic velocity jitter for a note at a given position.
 *
 * Uses a hash of the measure's absolute time and the beat offset to produce
 * a consistent per-note offset. The same passage always sounds the same on
 * replay, but different notes within and across measures get different jitter
 * values, eliminating the "machine gun" effect of identical velocities.
 *
 * @param measureStartTime - Absolute start time of the measure in seconds
 * @param beatOffset - Beat position within the measure (quarter-note beats)
 * @returns Integer velocity offset in [-HUMANIZE_MAX, +HUMANIZE_MAX]
 */
export function velocityHumanize(measureStartTime: number, beatOffset: number): number {
  // Deterministic pseudo-random hash: sin(x) * large_prime produces chaotic
  // fractional parts, giving a well-distributed [0,1) value per input pair.
  // This is a standard technique from GLSL shader noise functions.
  const x = measureStartTime * 12.9898 + beatOffset * 78.233;
  const hash = Math.abs(Math.sin(x) * 43758.5453) % 1.0;
  return Math.round(hash * 2 * HUMANIZE_MAX - HUMANIZE_MAX);
}

// ═══════════════════════════════════════════
// Timing humanization
// ═══════════════════════════════════════════

/** Maximum timing jitter in seconds (±15 ms). */
const TIMING_JITTER_MAX = 0.015;

/**
 * Deterministic per-note onset timing jitter.
 *
 * Real players never attack at exactly the same instant. This adds a small
 * random offset (±15 ms) to each note's onset time based on a hash of the
 * measure time, beat position, and part index. Using different magic
 * constants from velocityHumanize ensures timing and velocity jitter are
 * uncorrelated.
 *
 * The part index is included so that two parts playing the same rhythm get
 * different timing offsets, which is essential for realism in unisons.
 *
 * @param measureStartTime - Absolute start time of the measure in seconds
 * @param beatOffset - Beat position within the measure (quarter-note beats)
 * @param partIndex - Part index (so unison parts get different offsets)
 * @returns Timing offset in seconds in [-TIMING_JITTER_MAX, +TIMING_JITTER_MAX]
 */
export function timingHumanize(measureStartTime: number, beatOffset: number, partIndex: number): number {
  // Different constants from velocityHumanize to decorrelate timing and velocity.
  const x = measureStartTime * 17.1391 + beatOffset * 53.7829 + partIndex * 91.4173;
  const hash = Math.abs(Math.sin(x) * 29587.7139) % 1.0;
  return hash * 2 * TIMING_JITTER_MAX - TIMING_JITTER_MAX;
}
