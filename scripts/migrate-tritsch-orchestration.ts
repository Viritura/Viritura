import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { walkSequenceEvents, type Score, type SequenceContent } from "../packages/core/src/index";
import { parseMnx, serializeMnx } from "../packages/format/src/index";
import { normalizeTritschInstrumentIdentities } from "../apps/editor/src/instrumentIdentityNormalization/normalizeTritschInstrumentIdentities";
import {
  refreshOrchestralCondensedScore,
  splitOrchestralParts,
} from "../apps/editor/src/orchestralStaffSplit/transform";
import {
  analyzeWindVoiceConflicts,
  normalizeWindPlayerVoices,
  TRITSCH_WIND_BRASS_PART_IDS,
} from "../apps/editor/src/windVoiceNormalization/index";

const EXPECTED_PART_IDS = [
  "P1",
  "P2-1",
  "P2-2",
  "P3-1",
  "P3-2",
  "P4-1",
  "P4-2",
  "P5-1",
  "P5-2",
  "P6-1",
  "P6-2",
  "P7-1",
  "P7-2",
  "P7-3",
  "P8",
  "P9",
  "P10",
  "P11",
  "P12",
  "P13",
  "P14",
  "P15",
  "P16",
] as const;
const EXPECTED_CONDENSED_SOURCES = [
  ["P2-1", "P2-2"],
  ["P3-1", "P3-2"],
  ["P4-1", "P4-2"],
  ["P5-1", "P5-2"],
  ["P6-1", "P6-2"],
  ["P7-1", "P7-2"],
  ["P7-3"],
] as const;
const SPLIT_PLAYER_IDS = new Set(EXPECTED_PART_IDS.filter((partId) => /^P[2-7]-\d+$/.test(partId)));
const EXPECTED_WIND_CONFLICTS = new Set<string>();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    write: { type: "boolean", default: false },
    verify: { type: "boolean", default: false },
  },
});
const filePath = positionals[0];
if (!filePath) {
  throw new Error("Usage: pnpm tsx scripts/migrate-tritsch-orchestration.ts <score.mnx> [--write]");
}

const input = await readFile(filePath, "utf8");
const source = parseMnx(JSON.parse(input) as unknown);
if (values.verify) {
  verifyMigration(source);
  console.log(`Verification passed: ${filePath}`);
  printSummary(source);
  process.exit(0);
}
const splitScore = splitOrchestralParts(source);
const normalized = normalizeTritschInstrumentIdentities(splitScore);
const windNormalized = normalizeWindPlayerVoices(normalized);
const migrated = refreshOrchestralCondensedScore(windNormalized.score);
const document = serializeMnx(migrated);
const canonical = `${JSON.stringify(document, null, 2)}\n`;
const reparsed = parseMnx(JSON.parse(canonical) as unknown);
verifyMigration(reparsed);

if (!values.write) {
  console.log(`Dry run passed: ${filePath}`);
  printSummary(reparsed);
  process.exit(0);
}

const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.tmp`);
await writeFile(temporaryPath, canonical, "utf8");
await rename(temporaryPath, filePath);
console.log(`Migrated: ${filePath}`);
printSummary(reparsed);

function verifyMigration(score: typeof reparsed): void {
  verifyStructureAndProfile(score);
  verifySplitPlayerLabels(score);
  verifyWindVoices(score);
  const condensedLayout = requireCondensedLayout(score);
  const condensedSources = collectLayoutSources(condensedLayout.content);
  for (const expected of EXPECTED_CONDENSED_SOURCES) {
    if (!condensedSources.some((actual) => arraysEqual(actual, expected))) {
      throw new Error(`Missing condensed staff for ${expected.join("+")}.`);
    }
  }
  verifyPercussion(score, "P8", "timpani", undefined, undefined);
  verifyPercussion(score, "P9", "bass-drum", "P9-kit-0", 36);
  verifyPercussion(score, "P10", "triangle", "P10-kit-0", 81);
  verifyPercussion(score, "P11", "cymbals", "P11-kit-0", 49);
}

function verifyWindVoices(score: Score): void {
  const targetIds = new Set<string>(TRITSCH_WIND_BRASS_PART_IDS);
  const noteIds = new Set<string>();
  for (const part of score.parts) {
    if (!part.id || !targetIds.has(part.id)) continue;
    verifyPartReferences(part);
    part.measures.forEach((measure, measureIndex) => {
      if (measure.sequences.length === 0) {
        throw new Error(`${part.id} measure ${String(measureIndex + 1)} has no sequence.`);
      }
      measure.sequences.forEach((sequence, sequenceIndex) => {
        const expectedVoice = `v${String(sequenceIndex + 1)}`;
        if (sequence.voice !== expectedVoice) {
          throw new Error(
            `${part.id} measure ${String(measureIndex + 1)} sequence ${String(sequenceIndex + 1)} must use ${expectedVoice}.`,
          );
        }
        if (sequence.orient !== undefined) {
          throw new Error(`${part.id} measure ${String(measureIndex + 1)} retains sequence orient.`);
        }
        const events = [...walkSequenceEvents(sequence.content)];
        const hasNotes = events.some(({ event }) => Boolean(event.notes?.length || event.kitNotes?.length));
        if (measure.sequences.length > 1 && !hasNotes) {
          throw new Error(`${part.id} measure ${String(measureIndex + 1)} retains a redundant rest-only sequence.`);
        }
        verifyContentHasNoStemForcing(sequence.content, part.id, measureIndex + 1);
        for (const { event } of events) {
          for (const note of event.notes ?? []) {
            if (!note.id) continue;
            if (noteIds.has(note.id)) throw new Error(`Duplicate wind/brass note ID: ${note.id}.`);
            noteIds.add(note.id);
          }
        }
      });
    });
  }

  const conflicts = analyzeWindVoiceConflicts(score);
  if (conflicts.length !== EXPECTED_WIND_CONFLICTS.size) {
    const actual = new Set(conflicts.map((conflict) => `${conflict.partId}:${String(conflict.measure)}`));
    throw new Error(`Unexpected wind/brass chord conflicts: ${[...actual].join(", ") || "none"}.`);
  }
}

function verifyPartReferences(part: Score["parts"][number]): void {
  const { eventIds, noteIds } = collectPartReferenceIds(part);
  for (const measure of part.measures) {
    for (const beam of measure.beams ?? []) verifyBeamReferences(beam, eventIds, part.id ?? "(unknown)");
    for (const sequence of measure.sequences) {
      for (const { event } of walkSequenceEvents(sequence.content)) {
        verifyEventReferences(event, eventIds, noteIds, part.id ?? "(unknown)");
      }
    }
  }
}

function collectPartReferenceIds(part: Score["parts"][number]): {
  eventIds: Set<string>;
  noteIds: Set<string>;
} {
  const eventIds = new Set<string>();
  const noteIds = new Set<string>();
  for (const measure of part.measures) {
    for (const sequence of measure.sequences) {
      for (const { event } of walkSequenceEvents(sequence.content)) {
        if (event.id) eventIds.add(event.id);
        for (const note of event.notes ?? []) if (note.id) noteIds.add(note.id);
      }
    }
  }
  return { eventIds, noteIds };
}

function verifyEventReferences(
  event: Parameters<typeof walkSequenceEvents>[0][number] & { type: "event" },
  eventIds: ReadonlySet<string>,
  noteIds: ReadonlySet<string>,
  partId: string,
): void {
  for (const slur of event.slurs ?? []) {
    if (!eventIds.has(slur.target)) throw new Error(`${partId} has dangling slur target ${slur.target}.`);
  }
  for (const glissando of event.glissandos ?? []) {
    if (!noteIds.has(glissando.target)) throw new Error(`${partId} has dangling glissando target ${glissando.target}.`);
  }
  for (const note of event.notes ?? []) {
    for (const tie of note.ties ?? []) {
      if (tie.target && !noteIds.has(tie.target)) throw new Error(`${partId} has dangling tie target ${tie.target}.`);
    }
  }
}

function verifyBeamReferences(
  beam: NonNullable<Score["parts"][number]["measures"][number]["beams"]>[number],
  eventIds: ReadonlySet<string>,
  partId: string,
): void {
  for (const eventId of beam.events) {
    if (!eventIds.has(eventId)) throw new Error(`${partId} has dangling beam event ${eventId}.`);
  }
  for (const nested of beam.beams ?? []) verifyBeamReferences(nested, eventIds, partId);
}

function verifyContentHasNoStemForcing(
  content: readonly SequenceContent[],
  partId: string,
  measureNumber: number,
): void {
  for (const item of content) {
    if (item.type === "event" && (item.stemDirection !== undefined || item.orient !== undefined)) {
      throw new Error(`${partId} measure ${String(measureNumber)} retains event stem forcing.`);
    }
    if (item.type === "tuplet" && item.orient !== undefined) {
      throw new Error(`${partId} measure ${String(measureNumber)} retains tuplet orient.`);
    }
    if ("content" in item) verifyContentHasNoStemForcing(item.content, partId, measureNumber);
  }
}

function verifySplitPlayerLabels(score: typeof reparsed): void {
  const fullScore = score.scores?.find((definition) => definition.name.trim().toLowerCase() === "full score");
  const fullLayout = score.layouts?.find((layout) => layout.id === fullScore?.layout);
  if (!fullLayout) throw new Error("Expected a Full Score layout.");
  verifySplitPlayerStaffLabels(fullLayout.content, "Full Score");

  for (const layout of score.layouts ?? []) {
    const sourceGroups = collectLayoutSources(layout.content);
    const partIds = new Set(sourceGroups.flat());
    if (sourceGroups.length === 0 || sourceGroups.some((sources) => sources.length !== 1) || partIds.size !== 1)
      continue;
    const partId = [...partIds][0];
    if (partId && SPLIT_PLAYER_IDS.has(partId)) {
      verifySplitPlayerStaffLabels(layout.content, `layout ${layout.id}`);
    }
  }
}

function verifySplitPlayerStaffLabels(
  content: NonNullable<typeof source.layouts>[number]["content"],
  context: string,
): void {
  for (const node of content) {
    if (node.type === "group") {
      verifySplitPlayerStaffLabels(node.content, context);
      continue;
    }
    const partId = node.sources.length === 1 ? node.sources[0]?.part : undefined;
    if (!partId || !SPLIT_PLAYER_IDS.has(partId)) continue;
    if (!node.label?.trim() && node.labelref !== "name") {
      throw new Error(`${context} staff for ${partId} requires an explicit label or labelref name.`);
    }
  }
}

function verifyStructureAndProfile(score: typeof reparsed): void {
  const partIds = score.parts.map((part) => part.id);
  if (JSON.stringify(partIds) !== JSON.stringify(EXPECTED_PART_IDS)) {
    throw new Error(`Unexpected migrated part roster: ${partIds.join(", ")}`);
  }
  if (score.layouts?.length !== 25 || score.scores?.length !== 25) {
    throw new Error(
      `Expected 25 layouts and score definitions, found ${String(score.layouts?.length ?? 0)} layouts and ${String(score.scores?.length ?? 0)} definitions.`,
    );
  }
  if (score.scores?.[0]?.name.toLowerCase() !== "full score" || score.scores[1]?.name !== "Condensed Score") {
    throw new Error("Expected Full Score and Condensed Score as the first two score definitions.");
  }
  if (score.soundProfile?.profileId !== "viritura-sounds" || score.soundProfile.profileVersion !== 1) {
    throw new Error("Expected the VirituraSounds profile version 1.");
  }
  for (const partId of EXPECTED_PART_IDS) {
    if (!score.soundProfile.parts[partId]?.sourceId.endsWith("-primary")) {
      throw new Error(`Missing VirituraSounds assignment for ${partId}.`);
    }
  }
}

function requireCondensedLayout(score: typeof reparsed): NonNullable<typeof reparsed.layouts>[number] {
  const condensedScores =
    score.scores?.filter((definition) => definition.name.trim().toLowerCase() === "condensed score") ?? [];
  if (condensedScores.length !== 1) {
    throw new Error(`Expected exactly one Condensed Score definition, found ${String(condensedScores.length)}.`);
  }
  const condensedScore = condensedScores[0];
  const condensedLayout = score.layouts?.find((layout) => layout.id === condensedScore?.layout);
  if (!condensedLayout) throw new Error("Expected a Condensed Score layout.");
  return condensedLayout;
}

function verifyPercussion(
  score: typeof reparsed,
  partId: string,
  instrumentId: string,
  componentId: string | undefined,
  midiNumber: number | undefined,
): void {
  const part = score.parts.find((candidate) => candidate.id === partId);
  if (part?._x?.viritura?.instrumentId !== instrumentId) {
    throw new Error(`Expected ${partId} to use instrument ${instrumentId}.`);
  }
  if (!componentId) {
    if (part.kit) throw new Error(`${partId} must remain pitched percussion without a kit.`);
    return;
  }
  const soundId = part.kit?.[componentId]?.sound;
  if (!soundId || score.global.sounds?.[soundId]?.midiNumber !== midiNumber) {
    throw new Error(`Expected ${partId}/${componentId} to use MIDI percussion note ${String(midiNumber)}.`);
  }
}

function printSummary(score: typeof reparsed): void {
  console.log(`Parts:    ${String(score.parts.length)}`);
  console.log(`Layouts:  ${String(score.layouts?.length ?? 0)}`);
  console.log(`Scores:   ${String(score.scores?.length ?? 0)}`);
  console.log(`Profile:  ${score.soundProfile?.profileId ?? "none"}`);
  for (const conflict of analyzeWindVoiceConflicts(score)) {
    console.log(`Conflict: ${conflict.partId} measure ${String(conflict.measure)} (${conflict.pitches.join("+")})`);
  }
}

function collectLayoutSources(content: NonNullable<typeof source.layouts>[number]["content"]): string[][] {
  return content.flatMap((node): string[][] =>
    node.type === "group"
      ? collectLayoutSources(node.content)
      : [node.sources.map((layoutSource) => layoutSource.part)],
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
