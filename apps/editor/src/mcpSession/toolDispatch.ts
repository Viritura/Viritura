import { walkSequenceEvents, type Pitch, type ScorePatch } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { toast } from "sonner";
import { generateNoteId } from "../commands/noteCommands";
import type { DocumentStore } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import { analyzeChords } from "./chordAnalysis";
import { diffDocuments } from "./documentSummary";
import { validateScoreInput } from "./dryRunValidate";
import { getScoreInstruments, searchInstrumentCatalog } from "./instrumentRanges";
import { analyzeInstrumentChange, changeInstrumentInScore } from "../score/changeInstrument";
import { splitOrchestralParts } from "../orchestralStaffSplit";
import { normalizeTritschInstrumentIdentities } from "../instrumentIdentityNormalization";
import { normalizeWindPlayerVoices } from "../windVoiceNormalization";
import { getMeasureSlice, getSelectionContext } from "./scoreQueries";
import { getScoreTimeline, getScoreVideoSync, getSectionTimings } from "./scoreTimeline";
import { searchAnnotations } from "./annotationSearch";
import { getNoteTable } from "./noteTable";
import { useMcpSessionStore, type McpProposal } from "./sessionStore";
import { acceptMcpProposal } from "./proposalAcceptance";
import { appendPatchBatch, discardPatchBatch, getPatchBatch } from "./patchBatches";
import { readScorePatches } from "./scorePatches";
import { previewPatches, previewRepairs } from "./patchPreview";
import { executeIdempotentRequest } from "./idempotentRequests";

const MAX_WHOLE_DOCUMENT_PREVIEW_BYTES = 512 * 1024;

export interface McpToolResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent?: object;
  readonly isError?: boolean;
}

export async function dispatchMcpTool(
  documentStore: DocumentStore,
  name: string,
  args: unknown,
): Promise<McpToolResult> {
  const execute = (): McpToolResult => {
    try {
      const input = isObject(args) ? args : {};
      if (name.startsWith("preview.") && name !== "preview.get_status" && name !== "preview.get_batch") {
        const conflict = checkBaseRevision(documentStore, input);
        if (conflict) return conflict;
      }
      return dispatch(documentStore, name, args);
    } catch (error) {
      return failure("tool_failed", error instanceof Error ? error.message : String(error));
    }
  };
  const idempotent = name.startsWith("preview.") && name !== "preview.get_status" && name !== "preview.get_batch";
  const { result, replayed } =
    idempotent && isObject(args)
      ? executeIdempotentRequest(name, args, execute)
      : { result: execute(), replayed: false };
  const content = result.structuredContent;
  if (!content || result.isError) return result;
  const output: Record<string, unknown> = { ...content };
  if (replayed) {
    output.replayed = true;
    if (typeof output.proposalId === "string") {
      let proposal = useMcpSessionStore.getState().proposals[output.proposalId];
      if (proposal?.status === "pending" && proposal.originalRevision !== documentStore.getState().scoreRevision) {
        useMcpSessionStore.getState().setProposalStatus(proposal.id, "stale");
        proposal = useMcpSessionStore.getState().proposals[proposal.id];
      }
      if (proposal) {
        output.status = proposal.status;
        return {
          ...result,
          content: [{ type: "text", text: `Proposal ${proposal.id} is ${proposal.status} (replayed request).` }],
          structuredContent: {
            ...output,
            ...(documentStore.getState().workingScore ? { revision: documentStore.getState().scoreRevision } : {}),
          },
        };
      }
    }
  }
  if (documentStore.getState().workingScore) output.revision = documentStore.getState().scoreRevision;
  return { ...result, structuredContent: output };
}

function checkBaseRevision(documentStore: DocumentStore, input: Record<string, unknown>): McpToolResult | null {
  if (input.baseRevision === undefined) return null;
  if (typeof input.baseRevision !== "string" || input.baseRevision.length === 0) {
    return failure("invalid_revision", "baseRevision must be a non-empty revision string.");
  }
  const currentRevision = documentStore.getState().scoreRevision;
  if (input.baseRevision !== currentRevision) {
    return failure("revision_conflict", "The score changed since the requested base revision.", {
      baseRevision: input.baseRevision,
      currentRevision,
    });
  }
  return null;
}

function dispatch(documentStore: DocumentStore, name: string, args: unknown): McpToolResult {
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
    case "score.get_section_timings":
      return readSectionTimings(documentStore, args);
    case "score.search_annotations":
      return readAnnotations(documentStore, args);
    case "score.get_notes":
      return readNotes(documentStore, args);
    case "score.validate":
      return readValidation(documentStore, args);
    case "score.get_video_sync":
      return readVideoSync(documentStore);
    case "score.get_instruments":
      return readInstruments(documentStore, args);
    case "score.get_instrument_catalog":
      return success(searchInstrumentCatalog(args), "Returned matching instrument catalog entries.");
    case "preview.propose_patches":
      return proposePatches(documentStore, args);
    case "preview.propose_mnx":
      return proposeMnx(documentStore, args);
    case "preview.reset_stem_directions":
      return proposeAutomaticStemDirections(documentStore, args);
    case "preview.split_orchestral_staves":
      return proposeOrchestralStaffSplit(documentStore, args);
    case "preview.normalize_tritsch_instruments":
      return proposeTritschInstrumentNormalization(documentStore, args);
    case "preview.propose_chord_notes":
      return proposeChordNotes(documentStore, args);
    case "preview.change_instrument":
      return proposeInstrumentChange(documentStore, args);
    case "preview.get_status":
      return getProposalStatus(documentStore, args);
    case "preview.get_batch":
      return readPatchBatch(documentStore, args);
    case "preview.cancel_batch":
      return cancelPatchBatch(args);
    default:
      return failure("tool_not_found", `Unknown tool: ${name}`);
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

function readSectionTimings(documentStore: DocumentStore, args: unknown): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  return success(getSectionTimings(score, args), "Returned performed section timing summaries.");
}

function readAnnotations(documentStore: DocumentStore, args: unknown): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  return success(searchAnnotations(score, args), "Returned matching score annotations.");
}

function readNotes(documentStore: DocumentStore, args: unknown): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  return success(getNoteTable(score, args), "Returned a paginated table of notated events.");
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

function readInstruments(documentStore: DocumentStore, args: unknown): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const result = getScoreInstruments(score, args);
  return success(
    result,
    `Returned ${String(result.instruments.length)} instruments (${String(result.outOfRangeCount)} out of range).`,
  );
}

function proposeInstrumentChange(documentStore: DocumentStore, args: unknown): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const input = asObject(args);
  if (
    typeof input.partId !== "string" ||
    !input.partId ||
    typeof input.instrumentId !== "string" ||
    !input.instrumentId
  ) {
    return failure("invalid_instrument_change", "partId and instrumentId must be non-empty strings.");
  }
  const analysis = analyzeInstrumentChange(score, input.partId, input.instrumentId);
  if (!analysis.allowed) {
    return failure("instrument_change_unsafe", analysis.reason ?? "The instrument change is not safe.", { analysis });
  }
  const proposed = changeInstrumentInScore(score, input.partId, input.instrumentId);
  if (!proposed) return failure("instrument_change_failed", "The instrument change could not be prepared.");
  const oldPart = score.parts.find((part) => part.id === input.partId)!;
  const newPart = proposed.parts.find((part) => part.id === input.partId)!;
  const summary = `Change ${oldPart.name} to ${newPart.name}.${analysis.warning ? ` ${analysis.warning}` : ""}`;
  const result = proposeMnx(documentStore, {
    mnx: serializeMnx(proposed),
    summary,
    allowRhythmTruncation: input.allowRhythmTruncation,
  });
  if (result.isError) return result;
  return {
    ...result,
    structuredContent: {
      ...result.structuredContent,
      instrumentChange: {
        partId: input.partId,
        fromInstrumentId: oldPart._x?.viritura?.instrumentId ?? null,
        toInstrumentId: input.instrumentId,
        warning: analysis.warning ?? null,
      },
    },
  };
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
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  return success({ mnx: serializeMnx(score) }, "Returned the complete MNX document in structuredContent.mnx.");
}

function proposePatches(documentStore: DocumentStore, args: unknown): McpToolResult {
  const input = asObject(args);
  const rawPatches = input.patches;
  if (!Array.isArray(rawPatches) || rawPatches.length === 0 || rawPatches.length > 256) {
    return failure("invalid_patches", "patches must be an array containing 1 to 256 ScorePatch objects.");
  }
  const { batchId, final, allowRhythmTruncation } = input;
  if (batchId !== undefined && (typeof batchId !== "string" || batchId.length === 0 || batchId.length > 64)) {
    return failure("invalid_batch", "batchId must be a string of 1 to 64 characters.");
  }
  if (final !== undefined && typeof final !== "boolean") {
    return failure("invalid_batch", "final must be a boolean.");
  }
  if (allowRhythmTruncation !== undefined && typeof allowRhythmTruncation !== "boolean") {
    return failure("invalid_patches", "allowRhythmTruncation must be a boolean.");
  }

  let patches: ScorePatch[];
  try {
    patches = readScorePatches(rawPatches);
  } catch (error) {
    return failure("invalid_patches", error instanceof Error ? error.message : String(error));
  }
  const summary = typeof input.summary === "string" ? input.summary.slice(0, 240) : undefined;
  if (batchId === undefined) {
    if (final === false) return failure("invalid_batch", "final: false requires a batchId.");
    return stageProposal(
      documentStore,
      patches,
      summary ?? `${patches.length} score patches`,
      allowRhythmTruncation === true,
    );
  }
  return proposePatchBatch(documentStore, batchId, patches, final !== false, summary, allowRhythmTruncation === true);
}

function proposePatchBatch(
  documentStore: DocumentStore,
  batchId: string,
  patches: readonly ScorePatch[],
  final: boolean,
  summary: string | undefined,
  allowRhythmTruncation: boolean,
): McpToolResult {
  const state = documentStore.getState();
  if (!state.workingScore || !state.mnxJson) return failure("no_document", "No score is open in Viritura.");

  const result = appendPatchBatch(batchId, state.workingScore, state.scoreRevision, patches, !final);
  if (!result.ok) return failure(result.code, result.message);
  const patchCount = result.patches.length;
  if (!final) {
    return success(
      { batchId, status: "batching", patchCount },
      `Batch ${batchId} holds ${String(patchCount)} validated patches. Send the remaining patches with final: true to create one proposal.`,
    );
  }

  const proposal = stageProposal(
    documentStore,
    result.patches,
    summary ?? `${String(patchCount)} score patches`,
    allowRhythmTruncation,
  );
  if (!proposal.isError) discardPatchBatch(batchId);
  return proposal;
}

function proposeMnx(documentStore: DocumentStore, args: unknown): McpToolResult {
  const state = documentStore.getState();
  const currentScore = state.workingScore;
  if (!currentScore || !state.mnxJson) return failure("no_document", "No score is open in Viritura.");

  const input = asObject(args);
  if (input.mnx === undefined) {
    return failure("invalid_mnx", "mnx must be a complete MNX document (object or JSON string).");
  }
  if (input.allowRhythmTruncation !== undefined && typeof input.allowRhythmTruncation !== "boolean") {
    return failure("invalid_mnx", "allowRhythmTruncation must be a boolean.");
  }

  let preview;
  try {
    const document = typeof input.mnx === "string" ? (JSON.parse(input.mnx) as unknown) : structuredClone(input.mnx);
    preview = previewRepairs(parseMnx(document));
  } catch (error) {
    return failure("invalid_mnx", error instanceof Error ? error.message : String(error));
  }
  const repairFailure = rejectUnsafeRepairs(preview, input.allowRhythmTruncation === true);
  if (repairFailure) return repairFailure;
  const proposedScore = preview.score;

  const diff = diffDocuments(currentScore, proposedScore);
  const canonicalMnx = JSON.stringify(serializeMnx(proposedScore));
  const summary = typeof input.summary === "string" ? input.summary.slice(0, 240) : describeDiff(diff);

  const proposal: McpProposal = {
    id: crypto.randomUUID(),
    summary,
    patches: [],
    originalMnx: JSON.stringify(serializeMnx(currentScore)),
    originalRevision: state.scoreRevision,
    proposedMnx: null,
    document: { proposedMnx: canonicalMnx, diff },
    status: "pending",
  };
  const status = registerProposal(documentStore, proposal);
  return success(
    { proposalId: proposal.id, status, summary: proposal.summary, diff, repairs: preview.repairs },
    proposalResultText(proposal.id, status),
  );
}

function proposeAutomaticStemDirections(documentStore: DocumentStore, args: unknown): McpToolResult {
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
    allowRhythmTruncation: asObject(args).allowRhythmTruncation,
  });
}

function proposeOrchestralStaffSplit(documentStore: DocumentStore, args: unknown): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const proposedScore = splitOrchestralParts(score);
  return proposeMnx(documentStore, {
    mnx: serializeMnx(proposedScore),
    summary: "Split combined oboe, clarinet, bassoon, horn, trumpet, and trombone Parts and create a Condensed Score",
    allowRhythmTruncation: asObject(args).allowRhythmTruncation,
  });
}

function proposeTritschInstrumentNormalization(documentStore: DocumentStore, args: unknown): McpToolResult {
  const score = documentStore.getState().workingScore;
  if (!score) return failure("no_document", "No score is open in Viritura.");
  const identities = normalizeTritschInstrumentIdentities(score);
  const { score: proposedScore } = normalizeWindPlayerVoices(identities);
  return proposeMnx(documentStore, {
    mnx: serializeMnx(proposedScore),
    summary: "Normalize Tritsch instruments, wind voices and stems, sound profile, and percussion routing",
    allowRhythmTruncation: asObject(args).allowRhythmTruncation,
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
  if (input.allowRhythmTruncation !== undefined && typeof input.allowRhythmTruncation !== "boolean") {
    return failure("invalid_changes", "allowRhythmTruncation must be a boolean.");
  }
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
    input.allowRhythmTruncation === true,
  );
}

function stageProposal(
  documentStore: DocumentStore,
  patches: readonly ScorePatch[],
  summary: string,
  allowRhythmTruncation = false,
): McpToolResult {
  const state = documentStore.getState();
  const score = state.workingScore;
  if (!score || !state.mnxJson) return failure("no_document", "No score is open in Viritura.");

  const preview = previewPatches(score, patches);
  const repairFailure = rejectUnsafeRepairs(preview, allowRhythmTruncation);
  if (repairFailure) return repairFailure;
  const proposedDocument = serializeMnx(preview.score);
  const proposedJson = JSON.stringify(proposedDocument);
  const proposal: McpProposal = {
    id: crypto.randomUUID(),
    summary,
    patches: preview.effectivePatches,
    originalMnx: JSON.stringify(serializeMnx(score)),
    originalRevision: state.scoreRevision,
    proposedMnx:
      state.mnxJson.length <= MAX_WHOLE_DOCUMENT_PREVIEW_BYTES ? JSON.stringify(proposedDocument, null, 2) : null,
    ...(preview.needsDocumentCommit ? { repairMnx: proposedJson } : {}),
    status: "pending",
  };
  const status = registerProposal(documentStore, proposal);
  return success(
    {
      proposalId: proposal.id,
      status,
      summary: proposal.summary,
      repairs: preview.repairs,
      splicePreviews: preview.splicePreviews,
      splicePreviewsTruncated: preview.splicePreviewsTruncated,
    },
    proposalResultText(proposal.id, status),
  );
}

function rejectUnsafeRepairs(
  preview: ReturnType<typeof previewRepairs>,
  allowRhythmTruncation: boolean,
): McpToolResult | null {
  if (preview.remainingIssues.length > 0) {
    return failure("rhythm_unrepairable", "Some rhythmic issues could not be repaired.", { repairs: preview.repairs });
  }
  if (!allowRhythmTruncation && preview.repairs.some((repair) => repair.action === "truncate")) {
    return failure(
      "rhythm_truncation_requires_confirmation",
      "The editor would truncate overfull content. Review the repairs and retry with allowRhythmTruncation: true.",
      { repairs: preview.repairs },
    );
  }
  return null;
}

function registerProposal(documentStore: DocumentStore, proposal: McpProposal): "pending" | "accepted" {
  const session = useMcpSessionStore.getState();
  session.addProposal(proposal);
  if (!session.desired || !session.autoAccept) return "pending";
  try {
    acceptMcpProposal(documentStore, proposal);
    toast.success("MCP proposal auto-accepted");
    return "accepted";
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The proposal could not be applied.");
    throw error;
  }
}

function proposalResultText(id: string, status: "pending" | "accepted"): string {
  return status === "accepted"
    ? `Proposal ${id} was auto-accepted and applied in Viritura.`
    : `Proposal ${id} is awaiting review in Viritura.`;
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

function getProposalStatus(documentStore: DocumentStore, args: unknown): McpToolResult {
  const input = asObject(args);
  if (typeof input.proposalId !== "string") {
    return failure("invalid_proposal_id", "proposalId must be a string.");
  }
  let proposal = useMcpSessionStore.getState().proposals[input.proposalId];
  if (!proposal) return failure("proposal_not_found", "No proposal with that id exists in this editor session.");
  if (proposal.status === "pending" && proposal.originalRevision !== documentStore.getState().scoreRevision) {
    useMcpSessionStore.getState().setProposalStatus(proposal.id, "stale");
    proposal = useMcpSessionStore.getState().proposals[input.proposalId]!;
  }
  return success(
    {
      proposalId: proposal.id,
      status: proposal.status,
      summary: proposal.summary,
      baseRevision: proposal.originalRevision,
    },
    `Proposal ${proposal.id} is ${proposal.status}.`,
  );
}

function readPatchBatch(documentStore: DocumentStore, args: unknown): McpToolResult {
  const input = asObject(args);
  if (typeof input.batchId !== "string" || input.batchId.length === 0) {
    return failure("invalid_batch", "batchId must be a non-empty string.");
  }
  const batch = getPatchBatch(input.batchId, documentStore.getState().scoreRevision);
  if (!batch) return failure("batch_not_found", "No open batch with that id exists in this editor session.");
  return success(batch, `Batch ${batch.batchId} is ${batch.status}.`);
}

function cancelPatchBatch(args: unknown): McpToolResult {
  const input = asObject(args);
  if (typeof input.batchId !== "string" || input.batchId.length === 0) {
    return failure("invalid_batch", "batchId must be a non-empty string.");
  }
  if (!discardPatchBatch(input.batchId)) return failure("batch_not_found", "No open batch with that id exists.");
  return success({ batchId: input.batchId, status: "cancelled" }, `Batch ${input.batchId} was cancelled.`);
}

function success(value: object, text: string): McpToolResult {
  return { content: [{ type: "text", text }], structuredContent: value };
}

function failure(code: string, message: string, details?: object): McpToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { code, message, ...details },
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
