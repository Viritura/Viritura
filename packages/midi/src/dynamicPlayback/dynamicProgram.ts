import type { DynamicGroup, GlobalMeasure, Part, Sequence, TextExpression } from "@viritura/core";
import { buildDynamicsEnvelope } from "../dynamicsEnvelope";
import type { TempoModel } from "../tempoModel";
import { realizeDynamicsEnvelope, selectDynamicResponseProfile } from "./dynamicRealization";
import type { DynamicPlaybackDiagnostic, DynamicProgram, PlaybackLane, PlaybackLaneId } from "./types";
import type { ImpliedSectionDynamicAnchor } from "../sectionDynamics";

interface LaneScope {
  staff: number;
  voice: string;
}

function sequenceVoice(sequence: Sequence, index: number): string {
  return sequence.voice ?? `sequence:${index}`;
}

function collectContentStaves(content: Readonly<Sequence["content"]>, staves: Set<number>): void {
  for (const item of content) {
    if (item.type === "event") {
      if (item.staff !== undefined) staves.add(item.staff);
    } else if (item.type === "tuplet") {
      collectContentStaves(item.content, staves);
    } else if (item.type === "grace" || item.type === "tremolo") {
      for (const event of item.content) {
        if (event.staff !== undefined) staves.add(event.staff);
      }
    }
  }
}

export function playbackLaneId(partIndex: number, staff?: number, voice?: string): PlaybackLaneId {
  return staff === undefined || voice === undefined
    ? `part:${partIndex}`
    : `part:${partIndex}:staff:${staff}:voice:${voice}`;
}

function collectLaneScopes(part: Part): LaneScope[] {
  const byId = new Map<string, LaneScope>();
  for (const measure of part.measures) {
    measure.sequences.forEach((sequence, index) => {
      const voice = sequenceVoice(sequence, index);
      const staves = new Set([sequence.staff ?? 1]);
      collectContentStaves(sequence.content, staves);
      for (const staff of staves) {
        const scope = { staff, voice };
        byId.set(`${scope.staff}\u0000${scope.voice}`, scope);
      }
    });
  }
  return byId.size > 0 ? [...byId.values()] : [{ staff: 1, voice: "sequence:0" }];
}

function appliesToLane(group: DynamicGroup | TextExpression, scope: LaneScope): boolean {
  return (
    (group.staff === undefined || group.staff === scope.staff) &&
    (group.voice === undefined || group.voice === scope.voice)
  );
}

function withLaneDynamics(part: Part, scope: LaneScope): Part {
  return {
    ...part,
    measures: part.measures.map((measure) => ({
      ...measure,
      dynamics: measure.dynamics?.filter((group) => appliesToLane(group, scope)),
      expressions: measure.expressions?.filter((expression) => appliesToLane(expression, scope)),
    })),
  };
}

function collectScopeDiagnostics(part: Part, scopes: readonly LaneScope[]): DynamicPlaybackDiagnostic[] {
  const diagnostics: DynamicPlaybackDiagnostic[] = [];
  const voices = new Set(scopes.map((scope) => scope.voice));
  const reportedMissing = new Set<string>();
  for (const measure of part.measures) {
    for (const group of measure.dynamics ?? []) {
      if (group.voice && !voices.has(group.voice) && !reportedMissing.has(group.id)) {
        reportedMissing.add(group.id);
        diagnostics.push({
          code: "missing-voice",
          message: `Dynamic group ${group.id} targets voice ${group.voice}, which does not exist in the part.`,
          groupIds: [group.id],
        });
      }
    }
    const groups = measure.dynamics ?? [];
    for (let i = 0; i < groups.length; i++) {
      const left = groups[i]!;
      if (left.staff === undefined || left.voice !== undefined) continue;
      for (let j = i + 1; j < groups.length; j++) {
        const right = groups[j]!;
        if (right.staff !== undefined || right.voice === undefined) continue;
        if (
          left.position.fraction[0] * right.position.fraction[1] !==
          right.position.fraction[0] * left.position.fraction[1]
        )
          continue;
        if (!scopes.some((scope) => scope.staff === left.staff && scope.voice === right.voice)) continue;
        diagnostics.push({
          code: "scope-conflict",
          message: `Dynamic groups ${left.id} and ${right.id} have intersecting equal-specificity scopes at the same time.`,
          groupIds: [left.id, right.id].sort(),
        });
      }
    }
  }
  return diagnostics;
}

function collectRampDiagnostics(lanes: ReadonlyMap<PlaybackLaneId, PlaybackLane>): DynamicPlaybackDiagnostic[] {
  const diagnostics: DynamicPlaybackDiagnostic[] = [];
  const reported = new Set<string>();
  for (const lane of lanes.values()) {
    const ramps = [...lane.envelope.ramps].sort(
      (left, right) => left.startTime - right.startTime || left.groupId.localeCompare(right.groupId),
    );
    for (let index = 1; index < ramps.length; index++) {
      const previous = ramps[index - 1]!;
      const current = ramps[index]!;
      if (current.startTime >= previous.endTime - 1e-6) continue;
      const groupIds = [previous.groupId, current.groupId].sort();
      const key = groupIds.join("\u0000");
      if (reported.has(key)) continue;
      reported.add(key);
      diagnostics.push({
        code: "overlapping-gradual",
        message: `Dynamic groups ${groupIds.join(" and ")} overlap in playback lane ${lane.id}.`,
        groupIds,
      });
    }
  }
  return diagnostics;
}

/** Compile standard MNX groups into independently controllable playback lanes. */
export function compileDynamicProgram(
  part: Part,
  partIndex: number,
  measureOrder: readonly number[],
  measureStartBeats: readonly number[],
  model: TempoModel,
  globalMeasures: readonly GlobalMeasure[],
  gmProgram = -1,
  impliedAnchors: readonly ImpliedSectionDynamicAnchor[] = [],
): DynamicProgram {
  const scoped = part.measures.some((measure) =>
    measure.dynamics?.some((group) => group.staff !== undefined || group.voice !== undefined),
  );
  const scopes = collectLaneScopes(part);
  const selectedScopes = scoped ? scopes : [scopes[0]!];
  const profile = selectDynamicResponseProfile(gmProgram);
  const lanes = new Map<PlaybackLaneId, PlaybackLane>();

  for (const scope of selectedScopes) {
    const id = scoped ? playbackLaneId(partIndex, scope.staff, scope.voice) : playbackLaneId(partIndex);
    const lanePart = scoped ? withLaneDynamics(part, scope) : part;
    const envelope = realizeDynamicsEnvelope(
      buildDynamicsEnvelope(lanePart, measureOrder, measureStartBeats, model, globalMeasures, impliedAnchors),
      profile,
    );
    lanes.set(id, { id, partIndex, staff: scope.staff, voice: scope.voice, envelope });
  }

  return {
    lanes,
    diagnostics: [...collectScopeDiagnostics(part, scopes), ...collectRampDiagnostics(lanes)],
    scoped,
  };
}

/** Resolve a sequence to its compiled lane. */
export function laneForSequence(
  program: DynamicProgram,
  partIndex: number,
  sequence: Sequence,
  sequenceIndex: number,
): PlaybackLane {
  return laneForScope(program, partIndex, sequence.staff ?? 1, sequenceVoice(sequence, sequenceIndex));
}

/** Resolve an exact sounding staff/voice scope, including event-level
 *  cross-staff overrides within a sequence. */
export function laneForScope(program: DynamicProgram, partIndex: number, staff: number, voice: string): PlaybackLane {
  if (!program.scoped) return program.lanes.get(playbackLaneId(partIndex))!;
  const id = playbackLaneId(partIndex, staff, voice);
  return program.lanes.get(id) ?? program.lanes.values().next().value!;
}
