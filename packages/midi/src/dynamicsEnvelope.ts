/**
 * Dynamics envelope — couples velocity and CC11 (expression) so a single
 * notated dynamic level drives BOTH axes from one source of truth.
 *
 * Why two axes at all:
 *  - Velocity selects the SF2 sample layer (timbre) and the attack level. It is
 *    fixed at noteOn and cannot change while a note sustains.
 *  - CC11 (expression) is a per-voice amplitude scalar that DOES respond during
 *    a held note, so it carries the level and enables long-note shaping
 *    (hairpins, messa di voce).
 *
 * Perceived loudness is roughly `velGain(velocity) × CC11/127` — a PRODUCT. If
 * the dynamic level were encoded independently into both axes they would
 * "stack" (f² too loud, pp² inaudible). The fix here is a single mapping
 * `dynamic → {velocity, cc11}` (`DYNAMIC_AXES`): both axes derive from the same
 * level, so the combined curve is designed, not accidental. Each axis spans a
 * compressed range (velocity ~19 dB, cc11 ~11 dB) so the PRODUCT lands on a
 * musical ~30 dB orchestral range.
 *
 * The envelope models three things over a part's timeline:
 *  - ANCHORS: explicit graded dynamics (p, f, …) — a step function.
 *  - RAMPS: hairpins (cresc./dim.) — both axes interpolate CONTINUOUSLY across
 *    the span (velocity per note = anti-zipper; CC11 on a fine grid = smooth
 *    swell), so a multi-measure cresc over mixed short/long notes shapes
 *    correctly and a held note gets a real messa di voce. Consecutive hairpins
 *    chain (a dim. starting where a cresc. ends inherits its peak level), and an
 *    OPEN hairpin (no written target) moves one dynamic step in its direction.
 *  - ATTACKS: accent groups alter the note-on velocity at their onset without
 *    swelling unrelated held notes. An accent's `residualValue` additionally
 *    drops the persistent level, which is how `fp` is encoded.
 *
 * CC11 is owned exclusively by this system (the mute keyswitch is timbre-only —
 * CC74/71 — and no longer touches CC11). CC7 (channel volume) belongs to the
 * mixer and is never written here.
 */

import {
  walkSequenceEvents,
  type DynamicGroup,
  type DynamicValue,
  type GlobalMeasure,
  type GradualDynamicGroup,
  type Part,
} from "@viritura/core";
import type { ImpliedSectionDynamicAnchor } from "./sectionDynamics";
import type { MidiEvent } from "./types";
import type { TempoModel } from "./tempoModel";

/** CC 11 (expression). The coupled dynamics system is its sole owner. */
const CC_EXPRESSION = 11;

/** Time-coincidence tolerance (seconds). */
const EPS = 1e-6;

/** The two coupled MIDI axes a dynamic level maps to. */
export interface DynamicAxes {
  /** noteOn velocity (1–127): selects sample layer + attack level. */
  velocity: number;
  /** CC11 expression (0–127): sustained level, shapeable mid-note. */
  cc11: number;
}

/** Neutral default (mf) when no dynamic marking precedes a note. */
export const DEFAULT_DYNAMIC: DynamicAxes = { velocity: 84, cc11: 100 };

/**
 * Coupled velocity/CC11 calibration per dynamic marking.
 *
 * Velocity spans 30→127, CC11 spans 18→127; the product targets ~30 dB. These
 * are tuning constants — adjust by ear, keeping both axes monotonic with level.
 *
 * The score stores semantic values; these are the generic fallback realization
 * for an SF2/MIDI backend. Instrument-specific response profiles can project
 * the same semantic scale differently.
 */
export const DYNAMIC_AXES: Record<DynamicValue, DynamicAxes> = {
  n: { velocity: 1, cc11: 0 },
  pppppp: { velocity: 22, cc11: 11 },
  ppppp: { velocity: 28, cc11: 17 },
  pppp: { velocity: 34, cc11: 24 },
  ppp: { velocity: 42, cc11: 34 },
  pp: { velocity: 52, cc11: 50 },
  p: { velocity: 64, cc11: 66 },
  mp: { velocity: 74, cc11: 82 },
  mf: { velocity: 84, cc11: 100 },
  f: { velocity: 98, cc11: 112 },
  ff: { velocity: 112, cc11: 122 },
  fff: { velocity: 122, cc11: 127 },
  // CC11 saturates at fff, so the extreme fortissimos separate on velocity
  // alone — which is also what selects the loudest SF2 sample layers.
  ffff: { velocity: 124, cc11: 127 },
  fffff: { velocity: 126, cc11: 127 },
  ffffff: { velocity: 127, cc11: 127 },
};

/** Look up the coupled axes for a dynamic marking, or undefined if unknown. */
export function dynamicToAxes(value: DynamicValue): DynamicAxes {
  return DYNAMIC_AXES[value];
}

/** Axes for a standard dynamic value. */
function axesOf(value: DynamicValue): DynamicAxes {
  return DYNAMIC_AXES[value];
}

/** Graded dynamic ladder (soft → loud) for hairpin fallback stepping. */
const DYNAMIC_LADDER: readonly DynamicValue[] = [
  "n",
  "pppppp",
  "ppppp",
  "pppp",
  "ppp",
  "pp",
  "p",
  "mp",
  "mf",
  "f",
  "ff",
  "fff",
  "ffff",
  "fffff",
  "ffffff",
];

// ═══════════════════════════════════════════
// Envelope model
// ═══════════════════════════════════════════

/** An explicit graded dynamic at an absolute time (step). */
interface DynamicAnchor {
  time: number;
  velocity: number;
  cc11: number;
}

/** A hairpin span: both axes interpolate from `start` to `end` over the span. */
interface DynamicRamp {
  groupId: string;
  startTime: number;
  endTime: number;
  start: DynamicAxes;
  end: DynamicAxes;
}

/** A dynamic attack override at one onset. */
interface DynamicAttack {
  time: number;
  attackVelocity: number;
}

/** A part's coupled dynamics over time. */
export interface DynamicsEnvelope {
  anchors: readonly DynamicAnchor[];
  ramps: readonly DynamicRamp[];
  attacks: readonly DynamicAttack[];
}

/** Convert a measure-relative fraction (of a whole note) to quarter-note beats. */
function fractionToBeats(frac: readonly [number, number]): number {
  if (!frac || frac[1] === 0) return 0;
  return (frac[0] / frac[1]) * 4;
}

/** Clamp to [0,1]. */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Linear blend of two axes at fraction f (rounded to ints). */
function lerpAxes(a: DynamicAxes, b: DynamicAxes, frac: number): DynamicAxes {
  const f = clamp01(frac);
  return {
    velocity: Math.round(a.velocity + (b.velocity - a.velocity) * f),
    cc11: Math.round(a.cc11 + (b.cc11 - a.cc11) * f),
  };
}

/** Nearest ladder index to a given level (by velocity). */
function nearestLadderIndex(axes: DynamicAxes): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < DYNAMIC_LADDER.length; i++) {
    const dist = Math.abs(DYNAMIC_AXES[DYNAMIC_LADDER[i]!]!.velocity - axes.velocity);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Step one rung along the ladder in `dir` (+1 louder, −1 softer). */
function stepRung(axes: DynamicAxes, dir: 1 | -1): DynamicAxes {
  const i = nearestLadderIndex(axes);
  const j = Math.max(0, Math.min(DYNAMIC_LADDER.length - 1, i + dir));
  return DYNAMIC_AXES[DYNAMIC_LADDER[j]!]!;
}

/** Sample only the anchor step function (no ramps) at time `t`. */
function sampleAnchorsAxes(anchors: readonly DynamicAnchor[], t: number): DynamicAxes {
  let active: DynamicAxes = DEFAULT_DYNAMIC;
  for (const a of anchors) {
    if (a.time > t + EPS) break;
    active = { velocity: a.velocity, cc11: a.cc11 };
  }
  return active;
}

// ═══════════════════════════════════════════
// Build
// ═══════════════════════════════════════════

/** Map every global measure id → its original index (for hairpin end lookup). */
function buildMeasureIdToOrig(globalMeasures: readonly GlobalMeasure[]): Map<string, number> {
  const m = new Map<string, number>();
  globalMeasures.forEach((gm, i) => {
    if (gm.id) m.set(gm.id, i);
  });
  return m;
}

interface TimedDynamicGroup {
  group: DynamicGroup;
  time: number;
  expandedIdx: number;
}

interface TimedGradualText {
  id: string;
  startTime: number;
  dir: 1 | -1;
  expandedIdx: number;
}

function gradualTextDirection(text: string): 1 | -1 | undefined {
  const normalized = text.trim().toLocaleLowerCase();
  if (/^cresc(?:endo)?\.?$/.test(normalized)) return 1;
  if (/^(?:dim(?:inuendo)?|decresc(?:endo)?)\.?$/.test(normalized)) return -1;
  return undefined;
}

function collectMeasureDynamicGroups(
  pm: Part["measures"][number],
  measureStartBeat: number,
  model: TempoModel,
  expandedIdx: number,
  groups: TimedDynamicGroup[],
): void {
  for (const group of pm.dynamics ?? []) {
    groups.push({
      group,
      time: model.timeAtBeat(measureStartBeat + fractionToBeats(group.position.fraction)),
      expandedIdx,
    });
  }
}

function collectMeasureGradualTexts(
  pm: Part["measures"][number],
  measureStartBeat: number,
  model: TempoModel,
  expandedIdx: number,
  gradualTexts: TimedGradualText[],
): void {
  for (let index = 0; index < (pm.expressions?.length ?? 0); index++) {
    const expression = pm.expressions![index]!;
    const dir = gradualTextDirection(expression.text);
    if (!dir) continue;
    gradualTexts.push({
      id: `text-gradual-${expandedIdx}-${index}`,
      startTime: model.timeAtBeat(measureStartBeat + fractionToBeats(expression.position.fraction)),
      dir,
      expandedIdx,
    });
  }
}

/** Resolve a hairpin's end-measure start beat (nearest forward occurrence). */
function resolveEndMeasureBeat(
  endMeasureId: string,
  fromExpandedIdx: number,
  measureOrder: readonly number[],
  measureStartBeats: readonly number[],
  idToOrig: ReadonlyMap<string, number>,
): number | undefined {
  let targetOrig = idToOrig.get(endMeasureId);
  if (targetOrig === undefined) {
    // Fallback: some scores use the numeric measure index as the id.
    const parsed = Number.parseInt(endMeasureId, 10);
    if (!Number.isNaN(parsed)) targetOrig = parsed;
  }
  if (targetOrig === undefined) return undefined;
  for (let j = fromExpandedIdx; j < measureOrder.length; j++) {
    if (measureOrder[j] === targetOrig) return measureStartBeats[j];
  }
  for (let j = 0; j < measureOrder.length; j++) {
    if (measureOrder[j] === targetOrig) return measureStartBeats[j];
  }
  return undefined;
}

/** Axes of an explicit (authored) dynamic anchor at (≈) `time`, or undefined. */
function explicitAnchorAt(anchors: readonly DynamicAnchor[], time: number): DynamicAxes | undefined {
  for (const a of anchors) {
    if (Math.abs(a.time - time) <= EPS) return { velocity: a.velocity, cc11: a.cc11 };
  }
  return undefined;
}

/** A hairpin with resolved absolute start/end times and direction. */
interface TimedHairpin {
  groupId: string;
  startTime: number;
  endTime: number;
  dir: 1 | -1;
  start?: DynamicAxes;
  startsAfterSilence: boolean;
  measureStartTime: number;
}

function measureHasSoundingNotes(part: Part, measureIndex: number | undefined): boolean {
  if (measureIndex === undefined) return false;
  return (part.measures[measureIndex]?.sequences ?? []).some((sequence) =>
    [...walkSequenceEvents(sequence.content)].some(({ event }) => !!event.notes?.length || !!event.kitNotes?.length),
  );
}

function startsAfterSilentMeasure(part: Part, measureOrder: readonly number[], expandedIdx: number): boolean {
  return expandedIdx > 0 && !measureHasSoundingNotes(part, measureOrder[expandedIdx - 1]);
}

/**
 * Resolve timed hairpins to ramps in time order, CHAINING consecutive ones:
 * when a hairpin begins exactly where the previous one ended (and no explicit
 * dynamic is written there), it inherits the previous ramp's end level as its
 * start. This makes a messa di voce (a crescendo and decrescendo meeting at a
 * peak) connect smoothly instead of snapping back to the standing level at the
 * seam.
 *
 * Endpoint rules:
 *  - START: an explicit dynamic written at the start wins; else the chained
 *    previous end (if the hairpins meet); else the standing (sampled) level.
 *  - END: an explicit dynamic written at the end wins; else — for an OPEN
 *    hairpin with no written target — step ONE ladder rung in the hairpin's
 *    direction (cresc. → one louder, dim. → one softer). So a chained
 *    mf-crescendo→f then open decrescendo lands back on mf (f one rung down),
 *    giving a symmetric swell.
 */
function resolveRamps(timed: readonly TimedHairpin[], anchors: readonly DynamicAnchor[]): DynamicRamp[] {
  const ordered = [...timed].sort((a, b) => a.startTime - b.startTime);
  const ramps: DynamicRamp[] = [];
  let prev: DynamicRamp | undefined;
  for (const {
    groupId,
    startTime,
    endTime,
    dir,
    start: authoredStart,
    startsAfterSilence,
    measureStartTime,
  } of ordered) {
    if (endTime <= startTime + EPS) continue;
    const chained = prev !== undefined && Math.abs(prev.endTime - startTime) <= EPS;
    const currentMeasureAnchor = anchors.some(
      (anchor) => anchor.time >= measureStartTime - EPS && anchor.time <= startTime + EPS,
    );
    const start =
      authoredStart ??
      explicitAnchorAt(anchors, startTime) ??
      (startsAfterSilence && !currentMeasureAnchor
        ? axesOf("p")
        : chained
          ? prev!.end
          : sampleAnchorsAxes(anchors, startTime));
    const end = explicitAnchorAt(anchors, endTime) ?? stepRung(start, dir);
    const ramp: DynamicRamp = { groupId, startTime, endTime, start, end };
    ramps.push(ramp);
    prev = ramp;
  }
  return ramps;
}

/**
 * Build a part's dynamics envelope from standard dynamic groups. Walks the
 * expanded measure order, so repeated material yields one instance per pass.
 */
export function buildDynamicsEnvelope(
  part: Part,
  measureOrder: readonly number[],
  measureStartBeats: readonly number[],
  model: TempoModel,
  globalMeasures: readonly GlobalMeasure[],
  impliedAnchors: readonly ImpliedSectionDynamicAnchor[] = [],
): DynamicsEnvelope {
  const anchors: DynamicAnchor[] = [];
  const attacks: DynamicAttack[] = [];
  const timedGroups: TimedDynamicGroup[] = [];
  const gradualTexts: TimedGradualText[] = [];
  const idToOrig = buildMeasureIdToOrig(globalMeasures);

  // Pass 1: collect and order every dynamic group on the expanded timeline.
  for (let i = 0; i < measureOrder.length; i++) {
    const pm = part.measures[measureOrder[i]!];
    if (!pm) continue;
    const measureStartBeat = measureStartBeats[i]!;
    collectMeasureDynamicGroups(pm, measureStartBeat, model, i, timedGroups);
    collectMeasureGradualTexts(pm, measureStartBeat, model, i, gradualTexts);
  }
  const typeRank: Record<DynamicGroup["type"], number> = { immediate: 0, relative: 1, accent: 2, gradual: 3 };
  timedGroups.sort(
    (a, b) =>
      a.time - b.time || typeRank[a.group.type] - typeRank[b.group.type] || a.group.id.localeCompare(b.group.id),
  );

  // Pass 2: resolve persistent levels and onset attacks.
  for (const { group, time } of timedGroups) {
    if (group.type === "immediate") {
      const body = axesOf(group.value);
      anchors.push({ time, velocity: body.velocity, cc11: body.cc11 });
    } else if (group.type === "relative") {
      const current = sampleAnchorsAxes(anchors, time - EPS);
      const next = stepRung(current, group.relativeValue === "louder" ? 1 : -1);
      anchors.push({ time, velocity: next.velocity, cc11: next.cc11 });
    } else if (group.type === "accent") {
      // `value` is the attack; `residualValue` (the "p" of "fp") is the level
      // that persists from this onset onward.
      attacks.push({ time, attackVelocity: axesOf(group.value).velocity });
      if (group.residualValue !== undefined) {
        const body = axesOf(group.residualValue);
        anchors.push({ time, velocity: body.velocity, cc11: body.cc11 });
      }
    }
  }
  for (let expandedIdx = 0; expandedIdx < measureOrder.length; expandedIdx++) {
    const measureIndex = measureOrder[expandedIdx]!;
    for (const implied of impliedAnchors) {
      if (implied.measureIndex !== measureIndex) continue;
      const time = model.timeAtBeat(measureStartBeats[expandedIdx]! + fractionToBeats(implied.position));
      if (anchors.some((anchor) => Math.abs(anchor.time - time) <= EPS)) continue;
      const axes = axesOf(implied.value);
      anchors.push({ time, velocity: axes.velocity, cc11: axes.cc11 });
    }
  }
  anchors.sort((a, b) => a.time - b.time);

  // Pass 3: resolve gradual end times, then chain them into ramps.
  const timed: TimedHairpin[] = [];
  for (const { group, time: startTime, expandedIdx } of timedGroups) {
    if (group.type !== "gradual") continue;
    const gradual: GradualDynamicGroup = group;
    const endMeasureBeat = resolveEndMeasureBeat(
      gradual.end.measure,
      expandedIdx,
      measureOrder,
      measureStartBeats,
      idToOrig,
    );
    if (endMeasureBeat === undefined) continue;
    const endTime = model.timeAtBeat(endMeasureBeat + fractionToBeats(gradual.end.position.fraction));
    timed.push({
      groupId: gradual.id,
      startTime,
      endTime,
      dir: gradual.wedgeType === "increasing" ? 1 : -1,
      start: gradual.value === undefined ? undefined : axesOf(gradual.value),
      startsAfterSilence: startsAfterSilentMeasure(part, measureOrder, expandedIdx),
      measureStartTime: model.timeAtBeat(measureStartBeats[expandedIdx]!),
    });
  }
  for (const text of gradualTexts) {
    if (timed.some((hairpin) => Math.abs(hairpin.startTime - text.startTime) <= EPS)) continue;
    const endpoint = anchors.find((anchor) => anchor.time > text.startTime + EPS);
    if (!endpoint) continue;
    timed.push({
      groupId: text.id,
      startTime: text.startTime,
      endTime: endpoint.time,
      dir: text.dir,
      startsAfterSilence: startsAfterSilentMeasure(part, measureOrder, text.expandedIdx),
      measureStartTime: model.timeAtBeat(measureStartBeats[text.expandedIdx]!),
    });
  }
  const ramps = resolveRamps(timed, anchors);
  attacks.sort((a, b) => a.time - b.time);

  return { anchors, ramps, attacks };
}

/** Whether the part declares any dynamics at all. */
export function hasAnyDynamics(env: DynamicsEnvelope): boolean {
  return env.anchors.length > 0 || env.ramps.length > 0 || env.attacks.length > 0;
}

// ═══════════════════════════════════════════
// Sampling
// ═══════════════════════════════════════════

/** The ramp covering time `t`, if any. */
function rampAt(env: DynamicsEnvelope, t: number): DynamicRamp | undefined {
  for (const r of env.ramps) {
    if (t >= r.startTime - EPS && t <= r.endTime + EPS) return r;
  }
  return undefined;
}

/**
 * Sample the coupled axes (velocity + cc11) at absolute time `t`. A hairpin ramp
 * interpolates continuously across its span; elsewhere the anchor step holds.
 * Attacks do not alter the sampled standing level; see `noteVelocityAt`.
 */
export function sampleDynamics(env: DynamicsEnvelope, t: number): DynamicAxes {
  const r = rampAt(env, t);
  if (r) {
    const frac = (t - r.startTime) / (r.endTime - r.startTime);
    return lerpAxes(r.start, r.end, frac);
  }
  return sampleAnchorsAxes(env.anchors, t);
}

/** An attack override at (approximately) time `t`, if any. */
function attackAt(env: DynamicsEnvelope, t: number): DynamicAttack | undefined {
  for (const c of env.attacks) {
    if (Math.abs(c.time - t) <= EPS) return c;
  }
  return undefined;
}

/**
 * noteOn velocity at an onset: an authored attack velocity
 * overrides the sampled level; otherwise the sampled (possibly ramped) velocity.
 */
export function noteVelocityAt(env: DynamicsEnvelope, t: number): number {
  const c = attackAt(env, t);
  return c ? c.attackVelocity : sampleDynamics(env, t).velocity;
}

// ═══════════════════════════════════════════
// CC11 emission
// ═══════════════════════════════════════════

export interface Cc11Event {
  time: number;
  value: number;
}

/** Exact events where a linear ramp crosses a rounded 7-bit CC11 boundary. */
function rampQuantizationEvents(ramp: DynamicRamp): Cc11Event[] {
  const start = ramp.start.cc11;
  const end = ramp.end.cc11;
  if (start === end || ramp.endTime <= ramp.startTime + EPS) {
    return [
      { time: ramp.startTime, value: start },
      { time: ramp.endTime, value: end },
    ];
  }
  const direction = end > start ? 1 : -1;
  const events: Cc11Event[] = [{ time: ramp.startTime, value: start }];
  for (let value = start + direction; direction > 0 ? value <= end : value >= end; value += direction) {
    const boundary = value - direction * 0.5;
    const fraction = (boundary - start) / (end - start);
    events.push({
      time: ramp.startTime + fraction * (ramp.endTime - ramp.startTime),
      value,
    });
  }
  events.push({ time: ramp.endTime, value: end });
  return events;
}

/**
 * Resolve the ordered CC11 events for a part's envelope: a baseline at part
 * start, anchors, and exact rounded-value crossings. Consecutive equal values
 * are deduped, so a monotonic ramp emits no more than 127 useful writes.
 */
export function cc11Events(env: DynamicsEnvelope): Cc11Event[] {
  const raw: Cc11Event[] = [{ time: 0, value: sampleDynamics(env, 0).cc11 }];
  for (const anchor of env.anchors) raw.push({ time: anchor.time, value: anchor.cc11 });
  for (const ramp of env.ramps) raw.push(...rampQuantizationEvents(ramp));
  raw.sort((a, b) => a.time - b.time);

  const out: Cc11Event[] = [];
  for (const e of raw) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.time - e.time) <= EPS) {
      out[out.length - 1] = e; // same instant: later write wins
      continue;
    }
    if (prev && prev.value === e.value) continue; // unchanged level
    out.push(e);
  }
  if (out.length === 0 || out[0]!.time > EPS) {
    out.unshift({ time: 0, value: DEFAULT_DYNAMIC.cc11 });
  }
  return out;
}

/**
 * Append a part's coupled-dynamics CC11 (expression) MIDI events: a baseline at
 * part start plus one event per level change. CC11 is the sole dynamics level
 * axis (the mute keyswitch is timbre-only). The global sort places controlChange
 * before any noteOn at the same time.
 */
export function emitDynamicsCc11(
  env: DynamicsEnvelope,
  partIndex: number,
  channel: number,
  out: MidiEvent[],
  playbackLaneId?: string,
): void {
  for (const ev of cc11Events(env)) {
    out.push({
      type: "controlChange",
      time: ev.time,
      midiNote: 0,
      velocity: 0,
      partIndex,
      playbackLaneId,
      channel,
      cc: CC_EXPRESSION,
      value: ev.value,
    });
  }
}
