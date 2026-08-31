import type { LayoutContent, LayoutStaff, Part, Score, SequenceContent } from "@viritura/core";
import { getCatalogInstrument } from "./InstrumentCatalog";
import { createCatalogPart, effectiveKitFor, persistedPartNames } from "./catalogPart";
import { buildStaffNodeForPart, synchronizePartScoreDefinitions } from "./instrumentMutations";

export interface InstrumentChangeAnalysis {
  allowed: boolean;
  reason?: string;
  warning?: string;
}

function contentHasMusic(content: readonly SequenceContent[]): boolean {
  return content.some((item) => {
    if (item.type === "space") return false;
    if (item.type === "event") return (item.notes?.length ?? 0) > 0 || (item.kitNotes?.length ?? 0) > 0;
    if (item.type === "tuplet" || item.type === "grace" || item.type === "tremolo")
      return contentHasMusic(item.content);
    return false;
  });
}

function hasMusic(part: Part): boolean {
  return part.measures.some((measure) => measure.sequences.some((sequence) => contentHasMusic(sequence.content)));
}

function isPercussion(part: Part): boolean {
  return !!part.kit && Object.keys(part.kit).length > 0;
}

/** Check whether an existing part can be changed without deleting authored music. */
export function analyzeInstrumentChange(score: Score, partId: string, instrumentId: string): InstrumentChangeAnalysis {
  const part = score.parts.find((candidate) => candidate.id === partId);
  const instrument = getCatalogInstrument(instrumentId);
  if (!part || !instrument) return { allowed: false, reason: "The part or instrument no longer exists." };
  const oldStaves = part.staves ?? 1;
  const newStaves = instrument.staves ?? 1;
  let staffWarning: string | undefined;
  if (oldStaves > newStaves || (oldStaves > 1 && oldStaves !== newStaves)) {
    return {
      allowed: false,
      reason: `Changing from ${oldStaves} to ${newStaves} staves could move or discard music. Add the new instrument as a separate part instead.`,
    };
  }
  if (oldStaves === 1 && newStaves > 1) {
    const sharedStaff = (score.layouts ?? []).some((layout) =>
      layout.content.some((node) => layoutHasSharedPartStaff(node, partId)),
    );
    if (sharedStaff) {
      return {
        allowed: false,
        reason: "This part shares a condensed/doubling staff. Separate it in Layouts before expanding its staff count.",
      };
    }
    staffWarning = `Existing music will stay on staff 1. ${newStaves - 1} empty ${newStaves - 1 === 1 ? "staff" : "staves"} will be added.`;
  }
  const oldPercussion = isPercussion(part);
  const newPercussion = !!effectiveKitFor(instrument);
  if (oldPercussion !== newPercussion && hasMusic(part)) {
    return {
      allowed: false,
      reason:
        "Pitched notes and percussion-map notes are different MNX objects. Add the new instrument as a separate part instead.",
    };
  }
  if (oldPercussion && newPercussion && hasMusic(part)) {
    return {
      allowed: true,
      warning: [
        staffWarning,
        "Existing percussion notes will be rebound to the nearest position in the new percussion map.",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  return { allowed: true, ...(staffWarning ? { warning: staffWarning } : {}) };
}

function visitKitNotes(content: SequenceContent[], remap: ReadonlyMap<string, string>): void {
  for (const item of content) {
    if (item.type === "event") {
      for (const note of item.kitNotes ?? []) note.kitComponent = remap.get(note.kitComponent) ?? note.kitComponent;
    } else if (item.type === "tuplet" || item.type === "grace" || item.type === "tremolo") {
      visitKitNotes(item.content, remap);
    }
  }
}

function remapPercussionNotes(oldPart: Part, nextPart: Part): void {
  const oldKit = oldPart.kit ?? {};
  const nextEntries = Object.entries(nextPart.kit ?? {});
  if (nextEntries.length === 0) return;
  const remap = new Map<string, string>();
  for (const [oldId, component] of Object.entries(oldKit)) {
    let best = nextEntries[0]!;
    let bestDistance = Math.abs(best[1].staffPosition - component.staffPosition);
    for (const candidate of nextEntries.slice(1)) {
      const distance = Math.abs(candidate[1].staffPosition - component.staffPosition);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    remap.set(oldId, best[0]);
  }
  for (const measure of nextPart.measures) {
    for (const sequence of measure.sequences) visitKitNotes(sequence.content, remap);
  }
}

function replaceInitialClefs(existing: Part, template: Part): void {
  if (!existing.measures[0] || !template.measures[0]) return;
  const laterClefs = (existing.measures[0].clefs ?? []).filter((clef) => {
    const fraction = clef.position?.fraction;
    return fraction !== undefined && fraction[0] !== 0;
  });
  existing.measures[0] = {
    ...existing.measures[0],
    clefs: [...(template.measures[0].clefs ?? []), ...laterClefs],
  };
}

function layoutHasSharedPartStaff(node: LayoutContent, partId: string): boolean {
  if (node.type === "group") return node.content.some((child) => layoutHasSharedPartStaff(child, partId));
  return node.sources.some((source) => source.part === partId) && node.sources.length > 1;
}

function expandPartStaves(part: Part, template: Part, oldStaves: number, newStaves: number): void {
  if (newStaves <= oldStaves) return;
  part.measures.forEach((measure, measureIndex) => {
    measure.sequences = measure.sequences.map((sequence) => ({
      ...sequence,
      staff: sequence.staff ?? 1,
    }));
    const templateSequences = template.measures[measureIndex]?.sequences ?? [];
    for (let staff = oldStaves + 1; staff <= newStaves; staff++) {
      const empty = templateSequences.find((sequence) => sequence.staff === staff);
      measure.sequences.push(
        empty ? structuredClone(empty) : { content: [], fullMeasure: { visualDuration: { base: "whole" } }, staff },
      );
    }
  });
}

function replacePartStaffNode(node: LayoutContent, partId: string, replacement: LayoutContent): LayoutContent {
  if (node.type === "group") {
    return { ...node, content: node.content.map((child) => replacePartStaffNode(child, partId, replacement)) };
  }
  const staff = node as LayoutStaff;
  return staff.sources.length === 1 && staff.sources[0]?.part === partId ? structuredClone(replacement) : node;
}

function pruneUnusedKitSounds(score: Score): void {
  if (!score.global.sounds) return;
  const referenced = new Set(
    score.parts.flatMap((part) => Object.values(part.kit ?? {}).flatMap((component) => component.sound ?? [])),
  );
  for (const id of Object.keys(score.global.sounds)) {
    if (id.startsWith("snd-") && !referenced.has(id)) delete score.global.sounds[id];
  }
}

/** Change a part's catalog instrument when the migration is structurally safe. */
export function changeInstrumentInScore(score: Score, partId: string, instrumentId: string): Score | null {
  const analysis = analyzeInstrumentChange(score, partId, instrumentId);
  if (!analysis.allowed) return null;
  const partIndex = score.parts.findIndex((part) => part.id === partId);
  const oldPart = score.parts[partIndex];
  const instrument = getCatalogInstrument(instrumentId);
  if (!oldPart || !instrument) return null;

  const created = createCatalogPart(
    instrument,
    partId,
    persistedPartNames(instrument, { name: instrument.name, shortName: instrument.shortName }),
    score.global.measures.length,
    partIndex,
  );
  const oldPercussion = isPercussion(oldPart);
  const newPercussion = isPercussion(created.part);
  const oldStaves = oldPart.staves ?? 1;
  const newStaves = created.part.staves ?? 1;
  const nextPart: Part = {
    ...oldPart,
    name: created.part.name,
    shortName: created.part.shortName,
    staves: created.part.staves,
    transposition: created.part.transposition,
    kit: created.part.kit,
    _x: created.part._x,
    measures: structuredClone(oldPart.measures),
  };
  expandPartStaves(nextPart, created.part, oldStaves, newStaves);
  replaceInitialClefs(nextPart, created.part);
  if (oldPercussion && newPercussion) remapPercussionNotes(oldPart, nextPart);

  const next: Score = structuredClone(score);
  next.parts[partIndex] = nextPart;
  if (newStaves > oldStaves) {
    const replacement = buildStaffNodeForPart(instrument, partId);
    next.layouts = next.layouts?.map((layout) => ({
      ...layout,
      content: layout.content.map((node) => replacePartStaffNode(node, partId, replacement)),
    }));
  }
  next.global.sounds = { ...(next.global.sounds ?? {}), ...created.sounds };
  next.scores = synchronizePartScoreDefinitions(next.parts, next.scores ?? []);
  pruneUnusedKitSounds(next);
  return next;
}
