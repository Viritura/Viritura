/**
 * Playing-technique keyswitching for the MIDI timeline — pizz/arco bowing and
 * con sord./open muting, applied per measure as persistent state.
 *
 * Split out of `timeline.ts` (it crossed the 800-line file limit). This is the
 * self-contained "performance technique" sub-concept: it parses technique text
 * directions and emits the corresponding `programChange` / `controlChange`
 * events into the part's output buffer. The per-part traversal context
 * (`PartCtx`) and the `fractionToBeats` helper are shared back from
 * `timeline.ts`; `beatOffsetToTime` comes from the tempo map.
 */
import type { TextExpression } from "@viritura/core";
import { type PartCtx, fractionToBeats } from "./timeline";

/** GM program 45 — Pizzicato Strings. */
const GM_PIZZICATO_STRINGS = 45;

/**
 * Baseline GM programs for which pizz/arco keyswitching is meaningful:
 * solo strings (40–43) and string ensembles (48–49). On any other baseline
 * a "pizz."/"arco" text direction is ignored for playback.
 */
export const ARCO_CAPABLE_PROGRAMS = new Set([40, 41, 42, 43, 48, 49]);

/** Instrument family for mute (con sord.) handling, derived from GM program. */
export type MuteFamily = "strings" | "brass";

/**
 * Classify a GM program into a mute-capable family. Strings (40–51, incl.
 * solo + ensemble + synth strings) and brass (56–63). Winds and everything
 * else return null — a "con sord." direction there is ignored for playback.
 */
export function muteFamilyForProgram(program: number): MuteFamily | null {
  if (program >= 40 && program <= 51) return "strings";
  if (program >= 56 && program <= 63) return "brass";
  return null;
}

// MIDI controllers used to approximate a mute via the synth's per-voice filter.
// These are per-channel (= per-part), applied inside the shared synth, so no
// audio-graph rework is needed. A mute is TIMBRE only here (CC 74/71); it does
// NOT touch level. CC 7 (channel volume) belongs to the mixer, and CC 11
// (expression) is owned exclusively by the coupled dynamics system.
/** CC 74 — Brightness (low-pass filter cutoff; 64 = neutral, lower = darker). */
const CC_BRIGHTNESS = 74;
/** CC 71 — Harmonic Intensity (filter resonance; 64 = neutral). */
const CC_RESONANCE = 71;

/** Filter curve applied to a channel for a given mute state (timbre only). */
interface MuteCurve {
  brightness: number;
  resonance: number;
}

/** Per-family muted curves and the shared "open" (restored) curve. */
const MUTE_CURVES: Record<MuteFamily, MuteCurve> = {
  // con sordino: soft, veiled — roll off brilliance, flat resonance.
  strings: { brightness: 44, resonance: 70 },
  // straight/Harmon mute: pinched and nasal, NOT dark. A muted trumpet keeps
  // (even emphasizes) its upper harmonics, so the cutoff stays near neutral —
  // a hard lowpass here silences high brass (the trumpet sits above the cutoff).
  // The nasal color comes mostly from resonance.
  brass: { brightness: 58, resonance: 84 },
};
/** Neutral curve restored on "senza sord." / "open". */
const OPEN_CURVE: MuteCurve = { brightness: 64, resonance: 64 };

/** A persistent technique direction parsed from an expression. */
export type TechniqueAction = { kind: "bow"; pizz: boolean } | { kind: "mute"; muted: boolean };

/** Normalized words that select pizzicato. */
const PIZZ_WORDS = new Set(["pizz", "pizzicato"]);
/** Normalized words that return to ordinary (arco) bowing. */
const ARCO_WORDS = new Set(["arco", "ord", "ordinario", "naturale", "nat"]);
/** Normalized words that engage a mute (con sordino). */
const MUTE_ON_WORDS = new Set(["consord", "consordino", "consordini", "muted", "mute", "sord", "sordino"]);
/** Normalized words that remove a mute (senza sordino / open). */
const MUTE_OFF_WORDS = new Set(["senzasord", "senzasordino", "senzasordini", "open", "viasord"]);

/**
 * Match an expression's text against the technique vocabulary, returning the
 * persistent state change it implies (bowing or mute), or null if it isn't a
 * recognized technique. Strips punctuation/whitespace so "pizz.", "(pizz.)",
 * "con sord." all match.
 */
export function classifyTechniqueText(text: string): TechniqueAction | null {
  const word = text.toLowerCase().replace(/[^a-z]/g, "");
  if (PIZZ_WORDS.has(word)) return { kind: "bow", pizz: true };
  if (ARCO_WORDS.has(word)) return { kind: "bow", pizz: false };
  if (MUTE_ON_WORDS.has(word)) return { kind: "mute", muted: true };
  if (MUTE_OFF_WORDS.has(word)) return { kind: "mute", muted: false };
  return null;
}

/** Persistent per-part technique state, threaded across measures. */
export interface TechniqueState {
  /** Active GM program (pizz vs the part baseline). */
  program: number;
  /** Whether the part is currently muted (con sord.). */
  muted: boolean;
}

/** Emit a controlChange event for one CC at a given time. */
function emitCc(ctx: PartCtx, time: number, cc: number, value: number): void {
  ctx.out.push({
    type: "controlChange",
    time,
    midiNote: 0,
    velocity: 0,
    partIndex: ctx.partIndex,
    channel: ctx.channel,
    cc,
    value,
  });
}

/**
 * Keyswitch-style technique application for a single measure.
 *
 * Scans the measure's text expressions for pizz/arco and con sord./open
 * markings and emits the corresponding control events whenever a state
 * changes. The synth holds each setting until the next change, so techniques
 * persist across notes and measures — exactly like a sampler keyswitch.
 *
 * - Bowing (strings only): `pizz.` → GM Pizzicato Strings via `programChange`;
 *   `arco` restores the part baseline.
 * - Mute (strings + brass): `con sord.` applies a per-family filter curve via
 *   CC 74/71 (timbre only); `senza sord.`/`open` restores the neutral curve.
 *
 * Returns the updated state so the caller threads it into the next measure.
 */
export function applyMeasureTechniques(
  expressions: readonly TextExpression[] | undefined,
  ctx: PartCtx,
  state: TechniqueState,
  caps: { bow: boolean; mute: MuteFamily | null },
): TechniqueState {
  if (!expressions || expressions.length === 0) return state;

  // Resolve technique markings and sort by beat so transitions within the
  // measure resolve in playing order.
  const marks = expressions
    .map((e) => ({ action: classifyTechniqueText(e.text), beat: fractionToBeats(e.position.fraction) }))
    .filter((m): m is { action: TechniqueAction; beat: number } => m.action !== null)
    .sort((a, b) => a.beat - b.beat);

  let { program, muted } = state;
  for (const mark of marks) {
    const time = ctx.model.timeAtBeat(ctx.measureStartBeat + mark.beat);
    if (mark.action.kind === "bow" && caps.bow) {
      const target = mark.action.pizz ? GM_PIZZICATO_STRINGS : ctx.gmProgram;
      if (target === program) continue;
      program = target;
      // The global sort orders this programChange before any noteOn at the same time.
      ctx.out.push({
        type: "programChange",
        time,
        midiNote: 0,
        velocity: 0,
        partIndex: ctx.partIndex,
        channel: ctx.channel,
        program: target,
      });
    } else if (mark.action.kind === "mute" && caps.mute) {
      if (mark.action.muted === muted) continue;
      muted = mark.action.muted;
      const curve = muted ? MUTE_CURVES[caps.mute] : OPEN_CURVE;
      emitCc(ctx, time, CC_BRIGHTNESS, curve.brightness);
      emitCc(ctx, time, CC_RESONANCE, curve.resonance);
    }
  }
  return { program, muted };
}
