import {
  generateId,
  type LyricLineType,
  type LyricWorkflowSource,
  type LyricWorkflowToken,
  type NoteEvent,
  type Score,
  type SequenceContent,
} from "@viritura/core";
import { getContentArrayForLocation, getNoteEventAtLocation, type EventLocation } from "../score/ElementPath";
import { produce } from "../score/scoreClone";
import type { SelectionState } from "../store/selectionStore";
import { resolveSelectionEvents } from "../store/selectionUtils";

type LyricMappingSeverity = "error" | "warning";

type LyricMappingIssueCode =
  | "empty-source"
  | "invalid-hyphenation"
  | "no-destinations"
  | "mixed-voice"
  | "too-many-tokens"
  | "too-few-tokens"
  | "rest-destination"
  | "tie-continuation"
  | "existing-lyric"
  | "missing-event-id";

interface LyricMappingIssue {
  readonly code: LyricMappingIssueCode;
  readonly severity: LyricMappingSeverity;
  readonly message: string;
  readonly tokenIndex?: number;
  readonly destinationIndex?: number;
}

interface ParsedLyricToken {
  readonly text?: string;
  readonly type?: LyricLineType;
  readonly skip?: true;
  readonly generated?: true;
}

export interface ParsedVerse {
  readonly tokens: readonly ParsedLyricToken[];
  readonly issues: readonly LyricMappingIssue[];
  readonly requiresSyllabificationConfirmation: boolean;
}

interface LyricDestination {
  readonly location: EventLocation;
  readonly eventId?: string;
  readonly partId?: string;
  readonly sequenceIndex: number;
  readonly kind: "note" | "rest";
  readonly tieContinuation: boolean;
  readonly existingText?: string;
  readonly existingType?: LyricLineType;
}

interface LyricAssignment {
  readonly token: ParsedLyricToken;
  readonly destination: LyricDestination;
  readonly tokenIndex: number;
  readonly destinationIndex: number;
}

export interface LyricDistributionPlan {
  readonly sourceText: string;
  readonly lineId: string;
  readonly language?: string;
  readonly tokens: readonly ParsedLyricToken[];
  readonly destinations: readonly LyricDestination[];
  readonly assignments: readonly LyricAssignment[];
  readonly issues: readonly LyricMappingIssue[];
  readonly requiresSyllabificationConfirmation: boolean;
}

export interface BuildLyricDistributionOptions {
  readonly languageAware?: boolean;
  readonly language?: string;
  readonly replaceExisting?: boolean;
}

const LANGUAGE_VOWELS: Readonly<Record<string, string>> = {
  de: "aeiouyäöü",
  en: "aeiouy",
  es: "aeiouáéíóúü",
  fr: "aeiouyàâæéèêëîïôœùûüÿ",
  it: "aeiouàèéìíîòóùú",
  pt: "aeiouáâãàçéêíóôõúü",
};
const SYLLABLE_HYPHEN = /[-\u00ad\u2010\u2011]/;

function vowelGroups(word: string, language?: string): Array<{ start: number; end: number }> {
  const primary = language?.toLowerCase().split("-")[0] ?? "";
  const vowels = LANGUAGE_VOWELS[primary] ?? "aeiouyáàâäãåæéèêëíìîïóòôöõœúùûü";
  const normalized = word.toLocaleLowerCase(primary || undefined);
  const groups: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let index = 0; index < normalized.length; index++) {
    const isVowel = vowels.includes(normalized[index]!);
    if (isVowel && start < 0) start = index;
    if (!isVowel && start >= 0) {
      groups.push({ start, end: index });
      start = -1;
    }
  }
  if (start >= 0) groups.push({ start, end: normalized.length });
  return groups;
}

function generatedSyllables(word: string, language?: string): string[] {
  if (word.length < 4 || !/^\p{L}+(?:['’]\p{L}+)?$/u.test(word)) return [word];
  const primary = language?.toLowerCase().split("-")[0] ?? "";
  const groups = vowelGroups(word, language);
  if (groups.length < 2) return [word];
  const boundaries: number[] = [];
  for (let index = 0; index < groups.length - 1; index++) {
    const current = groups[index]!;
    const next = groups[index + 1]!;
    const consonantCount = next.start - current.end;
    const consonants = word.slice(current.end, next.start).toLowerCase();
    boundaries.push(
      primary === "en" && consonants === "ng" ? next.start : consonantCount <= 1 ? current.end : next.start - 1,
    );
  }
  const syllables: string[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    syllables.push(word.slice(start, boundary));
    start = boundary;
  }
  syllables.push(word.slice(start));
  return syllables.filter(Boolean);
}

function syllabicType(index: number, count: number): LyricLineType {
  if (count === 1) return "whole";
  if (index === 0) return "start";
  if (index === count - 1) return "end";
  return "middle";
}

export function parseVerse(
  sourceText: string,
  options: Pick<BuildLyricDistributionOptions, "languageAware" | "language"> = {},
): ParsedVerse {
  const tokens: ParsedLyricToken[] = [];
  const issues: LyricMappingIssue[] = [];
  let generated = false;
  const words = sourceText.trim().split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (/^_+$/.test(word)) {
      for (let index = 0; index < word.length; index++) tokens.push({ skip: true });
      continue;
    }
    const explicitlyHyphenated = SYLLABLE_HYPHEN.test(word);
    const parts = explicitlyHyphenated
      ? word.split(SYLLABLE_HYPHEN)
      : options.languageAware
        ? generatedSyllables(word, options.language)
        : [word];
    if (parts.some((part) => part.length === 0)) {
      issues.push({
        code: "invalid-hyphenation",
        severity: "error",
        message: `“${word}” has a leading, trailing, or repeated hyphen.`,
      });
      continue;
    }
    const wasGenerated = !explicitlyHyphenated && parts.length > 1;
    generated ||= wasGenerated;
    parts.forEach((text, index) => {
      const type = syllabicType(index, parts.length);
      tokens.push({
        text,
        ...(type !== "whole" && { type }),
        ...(wasGenerated && { generated: true }),
      });
    });
  }
  if (tokens.length === 0) {
    issues.push({ code: "empty-source", severity: "error", message: "Enter at least one syllable or underscore." });
  }
  return { tokens, issues, requiresSyllabificationConfirmation: generated };
}

function collectSequenceEvents(content: readonly SequenceContent[], events: NoteEvent[]): void {
  for (const item of content) {
    if (item.type === "event") events.push(item);
    else if (item.type === "tuplet" || item.type === "tremolo") collectSequenceEvents(item.content, events);
  }
}

function collectIncomingTies(events: readonly NoteEvent[], incoming: Set<string>): void {
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    const ties = (event.notes ?? []).flatMap((note) => note.ties ?? []);
    for (const tie of ties) {
      if (tie.target) {
        incoming.add(tie.target.replace(/\/n\d+$/, ""));
        continue;
      }
      if (tie.targetType && tie.targetType !== "nextNote") continue;
      const next = events.slice(index + 1).find((candidate) => (candidate.notes?.length ?? 0) > 0);
      if (next?.id) incoming.add(next.id);
    }
  }
}

function incomingTieEventIds(score: Score): Set<string> {
  const incoming = new Set<string>();
  for (const part of score.parts) {
    const sequenceCount = Math.max(0, ...part.measures.map((measure) => measure.sequences.length));
    for (let sequenceIndex = 0; sequenceIndex < sequenceCount; sequenceIndex++) {
      const events: NoteEvent[] = [];
      for (const measure of part.measures) {
        const sequence = measure.sequences[sequenceIndex];
        if (sequence) {
          collectSequenceEvents(sequence.content, events);
        }
      }
      collectIncomingTies(events, incoming);
    }
  }
  return incoming;
}

function buildDestinations(score: Score, selection: SelectionState, lineId: string): LyricDestination[] {
  const incomingTies = incomingTieEventIds(score);
  return resolveSelectionEvents(selection, score).map((location) => {
    const event = getNoteEventAtLocation(score, location);
    const part = score.parts[location.partIndex];
    const kind = event && ((event.notes?.length ?? 0) > 0 || (event.kitNotes?.length ?? 0) > 0) ? "note" : "rest";
    return {
      location,
      ...(event?.id && { eventId: event.id }),
      ...(part?.id && { partId: part.id }),
      sequenceIndex: location.sequenceIndex,
      kind,
      tieContinuation: !!event?.id && incomingTies.has(event.id),
      ...(event?.lyrics?.lines?.[lineId]?.text !== undefined && {
        existingText: event.lyrics.lines[lineId]!.text,
      }),
      ...(event?.lyrics?.lines?.[lineId]?.type && {
        existingType: event.lyrics.lines[lineId]!.type,
      }),
    };
  });
}

function destinationIssues(
  tokens: readonly ParsedLyricToken[],
  destinations: readonly LyricDestination[],
  replaceExisting: boolean,
): LyricMappingIssue[] {
  const issues: LyricMappingIssue[] = [];
  if (destinations.length === 0) {
    issues.push({
      code: "no-destinations",
      severity: "error",
      message: "Select one or more rhythmic events before distributing lyrics.",
    });
    return issues;
  }
  const voices = new Set(
    destinations.map((destination) => `${destination.location.partIndex}:${destination.sequenceIndex}`),
  );
  if (voices.size > 1) {
    issues.push({
      code: "mixed-voice",
      severity: "error",
      message: "The selection crosses parts or voices. Select a range in one voice.",
    });
  }
  if (tokens.length > destinations.length) {
    issues.push({
      code: "too-many-tokens",
      severity: "error",
      message: `${tokens.length - destinations.length} token${tokens.length - destinations.length === 1 ? " has" : "s have"} no destination.`,
    });
  } else if (tokens.length < destinations.length) {
    issues.push({
      code: "too-few-tokens",
      severity: "warning",
      message: `${destinations.length - tokens.length} selected event${destinations.length - tokens.length === 1 ? "" : "s"} will remain unchanged.`,
    });
  }
  for (let index = 0; index < Math.min(tokens.length, destinations.length); index++) {
    const token = tokens[index]!;
    const destination = destinations[index]!;
    if (!destination.eventId) {
      issues.push({
        code: "missing-event-id",
        severity: "error",
        message: `Destination ${index + 1} has no stable event ID.`,
        tokenIndex: index,
        destinationIndex: index,
      });
    }
    if (destination.kind === "rest") {
      issues.push({
        code: "rest-destination",
        severity: token.skip ? "warning" : "error",
        message: token.skip
          ? `Token ${index + 1} explicitly skips a rest.`
          : `Token ${index + 1} would place text on a rest.`,
        tokenIndex: index,
        destinationIndex: index,
      });
    }
    if (destination.tieContinuation && !token.skip) {
      issues.push({
        code: "tie-continuation",
        severity: "error",
        message: `Token ${index + 1} would place text on a tie continuation; use an underscore to skip it.`,
        tokenIndex: index,
        destinationIndex: index,
      });
    }
    if (destination.existingText !== undefined && !replaceExisting) {
      issues.push({
        code: "existing-lyric",
        severity: "error",
        message: `Destination ${index + 1} already contains “${destination.existingText}”.`,
        tokenIndex: index,
        destinationIndex: index,
      });
    }
  }
  return issues;
}

export function buildLyricDistributionPlan(
  score: Score,
  selection: SelectionState,
  lineId: string,
  sourceText: string,
  options: BuildLyricDistributionOptions = {},
): LyricDistributionPlan {
  const parsed = parseVerse(sourceText, options);
  const destinations = buildDestinations(score, selection, lineId);
  const assignments = parsed.tokens.slice(0, destinations.length).map((token, index) => ({
    token,
    destination: destinations[index]!,
    tokenIndex: index,
    destinationIndex: index,
  }));
  return {
    sourceText,
    lineId,
    ...(options.language && { language: options.language }),
    tokens: parsed.tokens,
    destinations,
    assignments,
    issues: [...parsed.issues, ...destinationIssues(parsed.tokens, destinations, options.replaceExisting ?? false)],
    requiresSyllabificationConfirmation: parsed.requiresSyllabificationConfirmation,
  };
}

export function sourceTextFromSelection(score: Score, selection: SelectionState, lineId: string): string {
  const destinations = buildDestinations(score, selection, lineId);
  if (!destinations.some((destination) => destination.existingText !== undefined)) return "";
  let source = "";
  const startWord = (): void => {
    if (source && !source.endsWith("-") && !source.endsWith(" ")) source += " ";
  };
  for (const destination of destinations) {
    if (destination.existingText === undefined) {
      startWord();
      source += "_ ";
      continue;
    }
    startWord();
    source += destination.existingText;
    if (destination.existingType === "start" || destination.existingType === "middle") source += "-";
    else source += " ";
  }
  return source.trim();
}

export function canCommitLyricPlan(plan: LyricDistributionPlan, syllabificationConfirmed: boolean): boolean {
  return (
    !plan.issues.some((issue) => issue.severity === "error") &&
    (!plan.requiresSyllabificationConfirmation || syllabificationConfirmed)
  );
}

function assignToken(score: Score, assignment: LyricAssignment, lineId: string, tokenId: string): LyricWorkflowToken {
  const content = getContentArrayForLocation(score, assignment.destination.location);
  const event = content?.[assignment.destination.location.eventIndex];
  if (event?.type !== "event" || !event.id) {
    throw new Error(`Cannot assign lyric token ${assignment.tokenIndex + 1}: destination event is unavailable.`);
  }
  event.lyrics ??= {};
  event.lyrics.lines ??= {};
  if (assignment.token.skip) {
    delete event.lyrics.lines[lineId];
    if (Object.keys(event.lyrics.lines).length === 0) delete event.lyrics;
  } else {
    event.lyrics.lines[lineId] = {
      text: assignment.token.text ?? "",
      ...(assignment.token.type && { type: assignment.token.type }),
    };
  }
  return {
    id: tokenId,
    ...(assignment.token.text !== undefined && { text: assignment.token.text }),
    ...(assignment.token.type && { type: assignment.token.type }),
    ...(assignment.token.skip && { skip: true }),
    eventId: event.id,
    ...(assignment.destination.partId && { partId: assignment.destination.partId }),
    sequenceIndex: assignment.destination.sequenceIndex,
  };
}

export function applyLyricDistributionPlan(
  score: Score,
  plan: LyricDistributionPlan,
  syllabificationConfirmed: boolean,
  sourceId = generateId(),
): Score {
  if (!canCommitLyricPlan(plan, syllabificationConfirmed)) {
    throw new Error("Cannot commit a lyric distribution plan while it has unresolved errors.");
  }
  return produce(score, (draft) => {
    const previous = draft.lyricWorkflow?.sources[sourceId];
    const indexed = indexEvents(draft);
    for (const token of previous?.tokens ?? []) {
      const event = token.eventId ? indexed.get(token.eventId)?.event : undefined;
      const line = event?.lyrics?.lines?.[plan.lineId];
      if (!event || !line || line.text !== token.text) continue;
      delete event.lyrics!.lines![plan.lineId];
      if (Object.keys(event.lyrics!.lines!).length === 0) delete event.lyrics;
    }
    const tokens = plan.assignments.map((assignment, index) =>
      assignToken(draft, assignment, plan.lineId, previous?.tokens[index]?.id ?? generateId()),
    );
    const source: LyricWorkflowSource = {
      id: sourceId,
      lineId: plan.lineId,
      text: plan.sourceText,
      ...(plan.language && { language: plan.language }),
      tokens,
    };
    draft.lyricWorkflow ??= { sources: {} };
    draft.lyricWorkflow.sources[sourceId] = source;
  });
}

type LyricRepairIssueKind = "orphaned" | "revoiced" | "conflicting";

export interface LyricRepairIssue {
  readonly sourceId: string;
  readonly tokenId: string;
  readonly kind: LyricRepairIssueKind;
  readonly message: string;
}

interface IndexedEvent {
  readonly event: NoteEvent;
  readonly partId?: string;
  readonly sequenceIndex: number;
}

function indexEvents(score: Score): Map<string, IndexedEvent> {
  const events = new Map<string, IndexedEvent>();
  for (const part of score.parts) {
    for (const measure of part.measures) {
      measure.sequences.forEach((sequence, sequenceIndex) => {
        const sequenceEvents: NoteEvent[] = [];
        collectSequenceEvents(sequence.content, sequenceEvents);
        for (const event of sequenceEvents) {
          if (event.id) events.set(event.id, { event, partId: part.id, sequenceIndex });
        }
      });
    }
  }
  return events;
}

export function inspectLyricWorkflow(score: Score): LyricRepairIssue[] {
  const indexed = indexEvents(score);
  const issues: LyricRepairIssue[] = [];
  for (const source of Object.values(score.lyricWorkflow?.sources ?? {})) {
    for (const token of source.tokens) {
      if (!token.eventId) {
        issues.push({
          sourceId: source.id,
          tokenId: token.id,
          kind: "orphaned",
          message: token.text ? `“${token.text}” is detached and needs review.` : "A melisma skip is detached.",
        });
        continue;
      }
      const indexedEvent = indexed.get(token.eventId);
      if (!indexedEvent) {
        issues.push({
          sourceId: source.id,
          tokenId: token.id,
          kind: "orphaned",
          message: token.text ? `“${token.text}” lost its rhythmic event.` : "A melisma skip lost its rhythmic event.",
        });
        continue;
      }
      if (indexedEvent.partId !== token.partId || indexedEvent.sequenceIndex !== token.sequenceIndex) {
        issues.push({
          sourceId: source.id,
          tokenId: token.id,
          kind: "revoiced",
          message: token.text
            ? `“${token.text}” moved to another part or voice.`
            : "A melisma skip moved to another part or voice.",
        });
      }
      const line = indexedEvent.event.lyrics?.lines?.[source.lineId];
      const conflicts = token.skip ? line !== undefined : line?.text !== token.text || line?.type !== token.type;
      if (conflicts) {
        issues.push({
          sourceId: source.id,
          tokenId: token.id,
          kind: "conflicting",
          message: token.text
            ? `“${token.text}” no longer matches its event.`
            : "A melisma skip now contains lyric text.",
        });
      }
    }
  }
  return issues;
}

export type LyricRepairAction = "follow-event" | "detach" | "delete";

function detachToken(token: LyricWorkflowToken): void {
  delete token.eventId;
  delete token.partId;
  delete token.sequenceIndex;
}

function removeTokenLyric(token: LyricWorkflowToken, lineId: string, indexed: ReadonlyMap<string, IndexedEvent>): void {
  const event = token.eventId ? indexed.get(token.eventId)?.event : undefined;
  if (!event) return;
  delete event.lyrics?.lines?.[lineId];
  if (event.lyrics?.lines && Object.keys(event.lyrics.lines).length === 0) delete event.lyrics;
}

function followToken(token: LyricWorkflowToken, lineId: string, indexed: ReadonlyMap<string, IndexedEvent>): void {
  const indexedEvent = token.eventId ? indexed.get(token.eventId) : undefined;
  if (!indexedEvent) {
    detachToken(token);
    return;
  }
  token.partId = indexedEvent.partId;
  token.sequenceIndex = indexedEvent.sequenceIndex;
  indexedEvent.event.lyrics ??= {};
  indexedEvent.event.lyrics.lines ??= {};
  if (token.skip) {
    delete indexedEvent.event.lyrics.lines[lineId];
    return;
  }
  indexedEvent.event.lyrics.lines[lineId] = {
    text: token.text ?? "",
    ...(token.type && { type: token.type }),
  };
}

export function repairLyricSource(
  score: Score,
  sourceId: string,
  action: LyricRepairAction,
  tokenIds?: ReadonlySet<string>,
): Score {
  const source = score.lyricWorkflow?.sources[sourceId];
  if (!source) throw new Error(`Unknown lyric workflow source: ${sourceId}`);
  return produce(score, (draft) => {
    const draftSource = draft.lyricWorkflow?.sources[sourceId];
    if (!draftSource) throw new Error(`Unknown lyric workflow source: ${sourceId}`);
    const indexed = indexEvents(draft);
    if (action === "delete") {
      for (const token of draftSource.tokens) {
        if (tokenIds && !tokenIds.has(token.id)) continue;
        removeTokenLyric(token, draftSource.lineId, indexed);
      }
      draftSource.tokens = tokenIds ? draftSource.tokens.filter((token) => !tokenIds.has(token.id)) : [];
      if (draftSource.tokens.length === 0) {
        delete draft.lyricWorkflow!.sources[sourceId];
        if (Object.keys(draft.lyricWorkflow!.sources).length === 0) delete draft.lyricWorkflow;
      }
      return;
    }
    for (const token of draftSource.tokens) {
      if (tokenIds && !tokenIds.has(token.id)) continue;
      if (action === "detach") detachToken(token);
      else followToken(token, draftSource.lineId, indexed);
    }
  });
}
