/**
 * VST playback coordination — pure helpers the conductor uses to run the native
 * VST host alongside the SF2 engine.
 *
 * Kept out of `PlaybackContext` so the transport component stays focused on
 * React/audio-engine wiring; these are side-effect-free (aside from the awaited
 * `prepare` call they delegate to) and independently testable.
 */

import type { Part } from "@viritura/core";
import type { ResolvedPlaybackPart } from "./soundProfileRuntime";
import type { Sf2PartAssignment, VstPartAssignment, VstPreparePlan, VstTransport } from "./vstTransport";

/**
 * Compute the engine's view-based part filter, combining the visible-part
 * selection with VST ownership.
 *
 * The base filter is the visible parts (or `null` = every part audible when the
 * view isn't filtered). Parts the native VST host plays are then subtracted so
 * their SF2 fallback voices stay silent (§3.8) — which, for the "all parts"
 * base, means enumerating every non-VST part. Returns `null` to mean "no filter,
 * play all".
 */
export function computeViewPartFilter(args: {
  parts: readonly Part[];
  visiblePartIds: readonly string[] | undefined;
  vstOwnedParts: ReadonlySet<number>;
}): ReadonlySet<number> | null {
  const { parts, visiblePartIds, vstOwnedParts } = args;

  let base: Set<number> | null = null;
  if (visiblePartIds && visiblePartIds.length > 0) {
    base = new Set<number>();
    for (const pid of visiblePartIds) {
      const idx = parts.findIndex((p) => p.id === pid);
      if (idx >= 0) base.add(idx);
    }
    if (base.size === 0) base = null;
  }

  if (vstOwnedParts.size === 0) return base;

  const filtered = new Set<number>();
  if (base) {
    for (const idx of base) if (!vstOwnedParts.has(idx)) filtered.add(idx);
  } else {
    for (let i = 0; i < parts.length; i++) if (!vstOwnedParts.has(i)) filtered.add(i);
  }
  return filtered;
}

/** Collect the VST-assigned parts (those resolved to a configured VST slot). */
export function collectVstAssignments(resolvedParts: readonly ResolvedPlaybackPart[]): VstPartAssignment[] {
  const assignments: VstPartAssignment[] = [];
  for (const resolved of resolvedParts) {
    if (resolved.vst) assignments.push({ partIndex: resolved.index, vst: resolved.vst });
  }
  return assignments;
}

/**
 * Collect the parts that should play through the native SoundFont in native
 * render mode: every non-VST part whose sound resolves to a supported pitched
 * SF2 voice. Percussion kits (`bankMsb === 128`) are intentionally excluded — the
 * native `rustysynth` voice does not yet map kit components — so they keep
 * playing through the browser SF2 engine, which still runs to drive the playhead.
 */
export function collectSf2Assignments(resolvedParts: readonly ResolvedPlaybackPart[]): Sf2PartAssignment[] {
  const assignments: Sf2PartAssignment[] = [];
  for (const resolved of resolvedParts) {
    if (resolved.vst) continue;
    if (resolved.sf2.kind !== "supported") continue;
    const primary = resolved.sf2.primary;
    if (primary.bankMsb === 128) continue;
    assignments.push({ partIndex: resolved.index, program: primary.program, isDrum: false });
  }
  return assignments;
}

/**
 * Prepare the native host for a play, returning the parts it took ownership of.
 * A host error leaves every part on the SF2 fallback (§3.8) rather than aborting
 * playback.
 */
export async function prepareVstOwnedParts(
  transport: VstTransport,
  score: Parameters<VstTransport["prepare"]>[0],
  plan: VstPreparePlan,
): Promise<ReadonlySet<number>> {
  try {
    return await transport.prepare(score, plan);
  } catch (error) {
    console.warn("VST host prepare failed; parts fall back to SF2:", error);
    return new Set<number>();
  }
}
