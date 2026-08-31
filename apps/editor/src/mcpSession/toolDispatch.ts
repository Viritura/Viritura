import { applyPatchesToScore, walkSequenceEvents, type Pitch, type ScorePatch } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { generateNoteId } from "../commands/noteCommands";
import type { DocumentStore } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import { analyzeChords } from "./chordAnalysis";
import { diffDocuments } from "./documentSummary";
import { validateScoreInput } from "./dryRunValidate";
import { getScoreInstruments } from "./instrumentRanges";
import { splitOrchestralParts } from "../orchestralStaffSplit";
import { normalizeTritschInstrumentIdentities } from "../instrumentIdentityNormalization";
import { normalizeWindPlayerVoices } from "../windVoiceNormalization";
import { getMeasureSlice, getSelectionContext } from "./scoreQueries";
import { getScoreTimeline, getScoreVideoSync } from "./scoreTimeline";
import { useMcpSessionStore, type McpProposal } from "./sessionStore";

const MAX_WHOLE_DOCUMENT_PREVIEW_BYTES = 512 * 1024;

interface McpToolResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent?: object;
  readonly isError?: boolean;
}

export async function dispatchMcpTool(
  documentStore: DocumentStore,
  name: string,
  args: unknown,
): Promise<McpToolResult> {
  try {
    switch (name) {
      case "score.overview":
        return readScoreOverview(documentStore);
      case "score.get_mnx":
        return readMnx(documentStore);
      case "score.get_measures":
        return readMeasures(documentStore, args);
      case "editor.get_selection":
        return success(useSelectionStore.getState().selection, "Returned the active editor selection.");
      case "editor.get_selected_music":
        return readSelectedMusic(documentStore);
      case "score.analyze_chords":
        return readChordAnalysis(documentStore, args);
      case "score.get_timeline":
        return readTimeline(documentStore, args);
      case "score.validate":
        return readValidation(documentStore, args);
      case "score.get_video_sync":
        return readVideoSync(documentStore);
      case "score.get_instruments":
        return readInstruments(documentStore);
      case "preview.propose_patches":
        return proposePatches(documentStore, args);
      case "preview.propose_mnx":
        return proposeMnx(documentStore, args);
      case "preview.reset_stem_directions":
        return proposeAutomaticStemDirections(documentStore);
      case "preview.split_orchestral_staves":
        return proposeOrchestralStaffSplit(documentStore);
      case "preview.normalize_tritsch_instruments":
        return proposeTritschInstrumentNormalization(documentStore);
      case "preview.propose_chord_notes":
        return proposeChordNotes(documentStore, args);
      case "preview.get_status":
        return getProposalStatus(args);
      default:
        return failure("tool_not_found", `Unknown tool: ${name}`);
    }
  } catch (error) {
    return failure("tool_failed", error instanceof Error ? error.message : String(error));
  }
}

function readMeasures(documentStore: DocumentStore, args: unknown): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const result = getMeasureSlice(score, args);
  return success(result, `Returned measures ${String(result.startMeasure)}–${String(result.endMeasure)}.`);
}

function readSelectedMusic(documentStore: DocumentStore): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  return success(
    getSelectionContext(score, useSelectionStore.getState().selection),
    "Returned the active selection and its resolved music.",
  );
}

function readChordAnalysis(documentStore: DocumentStore, args: unknown): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const result = analyzeChords(score, args);
  return success(result, `Analyzed chords in measures ${String(result.startMeasure)}–${String(result.endMeasure)}.`);
}

function readTimeline(documentStore: DocumentStore, args: unknown): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const result = getScoreTimeline(score, args);
  return success(
    result,
    `Returned the timeline for measures ${String(result.startMeasure)}–${String(result.endMeasure)} ` +
      `(total ${(result.totalDurationSeconds as number).toFixed(2)} s).`,
  );
}

function readValidation(documentStore: DocumentStore, args: unknown): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const result = validateScoreInput(score, args);
  return success(
    result,
    result.valid ? "The input validates cleanly." : `Validation failed: ${result.diagnostics.join("; ")}`,
  );
}

function readVideoSync(documentStore: DocumentStore): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const result = getScoreVideoSync(score);
  return success(result, result.videoSync ? "Returned the persisted video-sync settings." : "No video sync is set.");
}

function readInstruments(documentStore: DocumentStore): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const result = getScoreInstruments(score);
  return success(
    result,
    `Returned ${String(score.parts.length)} instruments (${String(result.outOfRangeCount)} out of range).`,
  );
}

function readScoreOverview(documentStore: DocumentStore): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const overview = {
    title: score.metadata?.title ?? null,
    composer: score.metadata?.composer ?? null,
    measureCount: score.global.measures.length,
    partCount: score.parts.length,
    parts: score.parts.map((part, index) => ({
      index,
      id: part.id ?? null,
      name: part.name,
      shortName: part.shortName ?? null,
      staves: part.staves ?? 1,
    })),
  };
  return success(overview, JSON.stringify(overview));
}

function readMnx(documentStore: DocumentStore): McpToolResult {
  const mnxJson = documentStore.getState().mnxJson;
  if (!mnxJson) return failure("no_document", "No score is open in Viritura.");
  return success(
    { mnx: JSON.parse(mnxJson) as Record<string, unknown> },
    "Returned the complete MNX document in structuredContent.mnx.",
  );
}

function proposePatches(documentStore: DocumentStore, args: unknown): McpToolResult {
  const input = asObject(args);
  const rawPatches = input.patches;
  if (!Array.isArray(rawPatches) || rawPatches.length === 0 || rawPatches.length > 256) {
    return failure("invalid_patches", "patches must be an array containing 1 to 256 ScorePatch objects.");
  }
  if (!rawPatches.every((patch) => isObject(patch) && typeof patch.kind === "string")) {
    return failure("invalid_patches", "Every patch must be an object with a kind discriminator.");
  }

  return stageProposal(
    documentStore,
    structuredClone(rawPatches) as ScorePatch[],
    typeof input.summary === "string" ? input.summary.slice(0, 240) : `${rawPatches.length} score patches`,
  );
}

function proposeMnx(documentStore: DocumentStore, args: unknown): McpToolResult {
  const state = documentStore.getState();
  const currentScore = state.workingScore;
  if (!currentScore || !state.mnxJson) return failure("no_document", "No score is open in Viritura.");

  const input = asObject(args);
  if (input.mnx === undefined) {
    return failure("invalid_mnx", "mnx must be a complete MNX document (object or JSON string).");
  }

  let proposedScore;
  try {
    const document = typeof input.mnx === "string" ? (JSON.parse(input.mnx) as unknown) : structuredClone(input.mnx);
    // parseMnx runs the schema assertion and throws on any violation.
    proposedScore = parseMnx(document);
  } catch (error) {
    return failure("invalid_mnx", error instanceof Error ? error.message : String(error));
  }

  const diff = diffDocuments(currentScore, proposedScore);
  const canonicalMnx = JSON.stringify(serializeMnx(proposedScore));
  const summary = typeof input.summary === "string" ? input.summary.slice(0, 240) : describeDiff(diff);

  const proposal: McpProposal = {
    id: crypto.randomUUID(),
    summary,
    patches: [],
    originalMnx: state.mnxJson,
    proposedMnx: null,
    document: { proposedMnx: canonicalMnx, diff },
    status: "pending",
  };
  useMcpSessionStore.getState().addProposal(proposal);
  return success(
    { proposalId: proposal.id, status: proposal.status, summary: proposal.summary, diff },
    `Whole-document proposal ${proposal.id} is awaiting review in Viritura.`,
  );
}

function proposeAutomaticStemDirections(documentStore: DocumentStore): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");

  const proposedScore = structuredClone(score);
  let cleared = 0;
  for (const part of proposedScore.parts) {
    for (const measure of part.measures) {
      for (const sequence of measure.sequences) {
        for (const { event } of walkSequenceEvents(sequence.content)) {
          if (event.stemDirection !== undefined) {
            delete event.stemDirection;
            cleared += 1;
          }
        }
      }
    }
  }

  if (cleared === 0) {
    return success({ status: "unchanged", cleared }, "All note stem directions are already automatic.");
  }
  return proposeMnx(documentStore, {
    mnx: serializeMnx(proposedScore),
    summary: `Reset ${String(cleared)} note stem directions to automatic`,
  });
}

function proposeOrchestralStaffSplit(documentStore: DocumentStore): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const proposedScore = splitOrchestralParts(score);
  return proposeMnx(documentStore, {
    mnx: serializeMnx(proposedScore),
    summary: "Split combined oboe, clarinet, bassoon, horn, trumpet, and trombone Parts and create a Condensed Score",
  });
}

function proposeTritschInstrumentNormalization(documentStore: DocumentStore): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const identities = normalizeTritschInstrumentIdentities(score);
  const { score: proposedScore } = normalizeWindPlayerVoices(identities);
  return proposeMnx(documentStore, {
    mnx: serializeMnx(proposedScore),
    summary: "Normalize Tritsch instruments, wind voices and stems, sound profile, and percussion routing",
  });
}

function describeDiff(diff: ReturnType<typeof diffDocuments>): string {
  const parts = diff.metrics
    .filter((metric) => metric.delta !== 0)
    .map((metric) => `${signed(metric.delta)} ${metric.label.toLowerCase()}`);
  return parts.length > 0
    ? `Whole-document change: ${parts.join(", ")}`
    : "Whole-document change (no net count change)";
}

function signed(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}

function proposeChordNotes(documentStore: DocumentStore, args: unknown): McpToolResult {
  const input = asObject(args);
  if (!Array.isArray(input.changes) || input.changes.length === 0 || input.changes.length > 64) {
    return failure("invalid_changes", "changes must contain 1 to 64 event chord changes.");
  }
  const patches: ScorePatch[] = [];
  for (const rawChange of input.changes) {
    const change = asObject(rawChange);
    if (
      typeof change.partId !== "string" ||
      !Number.isInteger(change.measure) ||
      (change.measure as number) < 1 ||
      !Number.isInteger(change.voice) ||
      (change.voice as number) < 0 ||
      typeof change.eventId !== "string" ||
      !Array.isArray(change.pitches) ||
      change.pitches.length === 0 ||
      change.pitches.length > 12
    ) {
      return failure(
        "invalid_changes",
        "Each change requires partId, 1-based measure, 0-based voice, eventId, and 1 to 12 pitches.",
      );
    }
    for (const rawPitch of change.pitches) {
      const pitch = readPitch(rawPitch);
      patches.push({
        kind: "addNoteToEvent",
        locator: {
          sequencePath: {
            partId: change.partId,
            measureIndex: (change.measure as number) - 1,
            voice: change.voice as number,
          },
          eventId: change.eventId,
        },
        note: { id: generateNoteId(), pitch },
      });
    }
  }
  return stageProposal(
    documentStore,
    patches,
    typeof input.summary === "string" ? input.summary.slice(0, 240) : `Add ${patches.length} chord notes`,
  );
}

function stageProposal(documentStore: DocumentStore, patches: readonly ScorePatch[], summary: string): McpToolResult {
  const state = documentStore.getState();
  const score = state.workingScore;
  if (!score || !state.mnxJson) return failure("no_document", "No score is open in Viritura.");

  // The patch interpreter verifies targets and the MNX round-trip verifies the
  // resulting value shapes before anything is offered to the user.
  const proposedScore = applyPatchesToScore(score, patches);
  const proposedDocument = serializeMnx(proposedScore);
  parseMnx(structuredClone(proposedDocument));
  const proposal: McpProposal = {
    id: crypto.randomUUID(),
    summary,
    patches,
    originalMnx: state.mnxJson,
    proposedMnx:
      state.mnxJson.length <= MAX_WHOLE_DOCUMENT_PREVIEW_BYTES ? JSON.stringify(proposedDocument, null, 2) : null,
    status: "pending",
  };
  useMcpSessionStore.getState().addProposal(proposal);
  return success(
    { proposalId: proposal.id, status: proposal.status, summary: proposal.summary },
    `Proposal ${proposal.id} is awaiting review in Viritura.`,
  );
}

function readPitch(value: unknown): Pitch {
  const pitch = asObject(value);
  if (
    !["A", "B", "C", "D", "E", "F", "G"].includes(String(pitch.step)) ||
    !Number.isInteger(pitch.octave) ||
    (pitch.octave as number) < 0 ||
    (pitch.octave as number) > 9 ||
    (pitch.alter !== undefined && (!Number.isInteger(pitch.alter) || Math.abs(pitch.alter as number) > 2))
  ) {
    throw new Error("Pitch requires step A–G, octave 0–9, and optional integer alter from -2 to 2.");
  }
  return {
    step: pitch.step as Pitch["step"],
    octave: pitch.octave as Pitch["octave"],
    ...(pitch.alter === undefined ? {} : { alter: pitch.alter as number }),
  };
}

function getProposalStatus(args: unknown): McpToolResult {
  const input = asObject(args);
  if (typeof input.proposalId !== "string") {
    return failure("invalid_proposal_id", "proposalId must be a string.");
  }
  const proposal = useMcpSessionStore.getState().proposals[input.proposalId];
  if (!proposal) return failure("proposal_not_found", "No proposal with that id exists in this editor session.");
  return success(
    { proposalId: proposal.id, status: proposal.status, summary: proposal.summary },
    `Proposal ${proposal.id} is ${proposal.status}.`,
  );
}

function success(value: object, text: string): McpToolResult {
  return { content: [{ type: "text", text }], structuredContent: value };
}

function failure(code: string, message: string): McpToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { code, message },
    isError: true,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error("Tool arguments must be a JSON object.");
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
