/**
 * Unified element ID construction and resolution module.
 *
 * This is the TypeScript counterpart of the Rust `element_id.rs` module.
 * It provides:
 * 1. ID construction functions (mirrors Rust element_id.rs exactly)
 * 2. ID parsing into typed discriminated unions
 * 3. Score model resolution (ID → model object location)
 *
 * ALL element ID construction and parsing should go through this module.
 * No other file should contain template literals that build element IDs
 * or regex that parses element ID segments.
 */

import type { Score, Sequence, SequenceContent, NoteEvent } from "@viritura/core";

// ═══════════════════════════════════════════
// ID Construction (mirrors Rust element_id.rs)
// ═══════════════════════════════════════════

/** Sanitize a vendor MNX ID for internal use (replace / to prevent path confusion). */
function sanitize(mnxId: string): string {
  return mnxId.replace(/\//g, "_");
}

/** Event suffix: uses MNX id if present, otherwise auto-generated ID matching the Rust engine. */
export function eventSuffix(
  mnxId: string | undefined,
  index: number,
  measureIndex?: number,
  voiceIndex?: number,
): string {
  if (mnxId) return sanitize(mnxId);
  if (measureIndex != null && voiceIndex != null) {
    return `__auto_m${measureIndex}_v${voiceIndex}_e${index}`;
  }
  return `e${index}`;
}

// ── Events & sub-events ─────────────────────────────────────────────

export function eventId(part: number, measure: number, seq: number, suffix: string): string {
  return `p${part}/m${measure}/s${seq}/${suffix}`;
}

export function graceId(part: number, measure: number, seq: number, eventSuffix: string, graceSuffix: string): string {
  return `p${part}/m${measure}/s${seq}/${eventSuffix}/grace/${graceSuffix}`;
}

export function noteheadId(parentEventId: string, noteIndex: number): string {
  return `${parentEventId}/n${noteIndex}`;
}

/** Articulation on an event: `{eventId}/art-{name}` (see articulationNames). */
export function articulationId(parentEventId: string, name: string): string {
  return `${parentEventId}/art-${name}`;
}

export function tremoloId(parentEventId: string): string {
  return `${parentEventId}/trem`;
}

export function fermataId(parentEventId: string): string {
  return `${parentEventId}/ferm`;
}

// ── Part-scoped measure elements ────────────────────────────────────

export function clefId(part: number, measure: number): string {
  return `p${part}/m${measure}/clef`;
}

export function keySigId(part: number, measure: number): string {
  return `p${part}/m${measure}/key`;
}

export function dynamicId(part: number, measure: number, groupId: string): string {
  return `p${part}/m${measure}/dyn${groupId}`;
}

export function hairpinId(part: number, measure: number, groupId: string): string {
  return `p${part}/m${measure}/hairpin${groupId}`;
}

export function pedalId(part: number, measure: number, index: number): string {
  return `p${part}/m${measure}/pedal${index}`;
}

export function ottavaId(part: number, measure: number, index: number): string {
  return `p${part}/m${measure}/ottava${index}`;
}

export function expressionId(part: number, measure: number, index: number): string {
  return `p${part}/m${measure}/expr${index}`;
}

export function chordSymbolId(part: number, measure: number, index: number): string {
  return `p${part}/m${measure}/chord${index}`;
}

// ── Global measure elements ────────────────────────────────────────

export function timeSigId(measure: number): string {
  return `m${measure}/time`;
}

export function barlineId(measure: number): string {
  return `m${measure}/barline`;
}

export function tempoId(measure: number, index: number): string {
  return `m${measure}/tempo${index}`;
}

export function segnoId(measure: number): string {
  return `m${measure}/segno`;
}

export function codaId(measure: number): string {
  return `m${measure}/coda`;
}

export function fineId(measure: number): string {
  return `m${measure}/fine`;
}

export function jumpId(measure: number): string {
  return `m${measure}/jump`;
}

export function rehearsalId(measure: number): string {
  return `m${measure}/rehearsal`;
}

export function voltaId(measure: number): string {
  return `m${measure}/volta`;
}

export function measureNumberId(measure: number): string {
  return `m${measure}/mnum`;
}

// ═══════════════════════════════════════════
// ID Parsing — discriminated union types
// ═══════════════════════════════════════════

/** Parsed event location from an element ID. */
export interface EventLocation {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  /** Index into the content array (top-level or inside a tuplet). */
  eventIndex: number;
  /**
   * If the event is inside a tuplet or tremolo container, this is the index of
   * that container in the sequence's top-level content array. Undefined for
   * top-level events. (Grace containers are addressed separately and never
   * appear here — grace ids fail closed in `parseEventPathSegments`.)
   */
  tupletIndex?: number;
  /** If a specific note in a chord is targeted, its index. Undefined = all notes. */
  noteIndex?: number;
}

/**
 * Get the content array that contains the event at the given location.
 * For top-level events, returns the sequence's content.
 * For events inside a tuplet or tremolo, returns that container's content.
 * (`tupletIndex` addresses both tuplet and tremolo containers by convention.)
 */
export function getContentArrayForLocation(score: Score, loc: EventLocation): SequenceContent[] | null {
  const seq = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
  if (!seq) return null;
  if (loc.tupletIndex !== undefined) {
    const container = seq.content[loc.tupletIndex];
    if (!container || (container.type !== "tuplet" && container.type !== "tremolo")) return null;
    return container.content;
  }
  return seq.content;
}

/**
 * Get the event at the given location, handling tuplet nesting.
 */
export function getEventAtLocation(score: Score, loc: EventLocation): SequenceContent | null {
  const content = getContentArrayForLocation(score, loc);
  return content?.[loc.eventIndex] ?? null;
}

/** Parsed annotation location from an element ID. */
export interface AnnotationLocation {
  kind: "part" | "global";
  type: string;
  measureIndex: number;
  partIndex?: number;
  annotationIndex?: number;
  annotationId?: string;
}

/** Part-scoped annotation prefixes (last segment starts with these). */
const PART_ANNOTATION_PREFIXES = ["dyn", "expr", "chord", "hairpin", "pedal", "ottava"] as const;

/** Global annotation suffixes (2-segment IDs: m{N}/{suffix}). */
const GLOBAL_ANNOTATION_SUFFIXES = [
  "tempo",
  "segno",
  "coda",
  "fine",
  "jump",
  "rehearsal",
  "volta",
  "mnum",
  "barline",
] as const;

/**
 * Extract part index from an element ID.
 * Returns undefined if the ID has no part prefix.
 */
export function extractPartIndex(elementId: string): number | undefined {
  const m = elementId.match(/^p(\d+)\//);
  return m ? parseInt(m[1]!, 10) : undefined;
}

/**
 * Extract measure index from an element ID.
 * Handles both `p{N}/m{N}/...` and `m{N}/...` formats.
 */
export function extractMeasureIndex(elementId: string): number | undefined {
  const m = elementId.match(/(?:^|\/)(m(\d+))/);
  return m ? parseInt(m[2]!, 10) : undefined;
}

/**
 * Extract sequence index from an element ID.
 * Returns undefined if the ID has no sequence segment.
 */
export function extractSequenceIndex(elementId: string): number | undefined {
  const m = elementId.match(/\/s(\d+)\//);
  return m ? parseInt(m[1]!, 10) : undefined;
}

interface EventBase {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
}

function parseEventPathSegments(elementId: string): { base: EventBase; evSuffix: string } | null {
  const segments = elementId.split("/");
  if (segments.length < 4) return null;

  // Fail closed on grace ids. A grace event's id is `{principal}/grace/{g}`,
  // so segments[3] here would be the PRINCIPAL's suffix — resolving it would
  // silently return the principal event instead of the grace. Grace ids must
  // be resolved through `resolveGraceLocation`; refusing them here turns a
  // missed grace path into a loud null rather than a wrong-but-plausible hit.
  if (segments.includes("grace")) return null;

  const partMatch = segments[0]?.match(/^p(\d+)$/);
  const measureMatch = segments[1]?.match(/^m(\d+)$/);
  const seqMatch = segments[2]?.match(/^s(\d+)$/);
  const evSuffix = segments[3];

  if (!partMatch || !measureMatch || !seqMatch || !evSuffix) return null;

  return {
    base: {
      partIndex: parseInt(partMatch[1]!, 10),
      measureIndex: parseInt(measureMatch[1]!, 10),
      sequenceIndex: parseInt(seqMatch[1]!, 10),
    },
    evSuffix,
  };
}

function findEventByModelId(sequence: Sequence, base: EventBase, evSuffix: string): EventLocation | null {
  const eventIndex = sequence.content.findIndex((ev) => (ev as { id?: string }).id === evSuffix);
  if (eventIndex !== -1) return { ...base, eventIndex };

  // tuplet and tremolo containers both project onto `tupletIndex` (grace has
  // its own resolver and is fail-closed in parseEventPathSegments).
  for (let ti = 0; ti < sequence.content.length; ti++) {
    const item = sequence.content[ti];
    if (item && (item.type === "tuplet" || item.type === "tremolo") && item.content) {
      const innerIdx = item.content.findIndex((ev) => (ev as { id?: string }).id === evSuffix);
      if (innerIdx !== -1) return { ...base, eventIndex: innerIdx, tupletIndex: ti };
    }
  }
  return null;
}

function parseFlatEventIndex(evSuffix: string): number {
  const indexMatch = evSuffix.match(/^e(\d+)$/);
  if (indexMatch) return parseInt(indexMatch[1]!, 10);
  const autoMatch = evSuffix.match(/__auto_m\d+_v\d+_e(\d+)$/);
  if (autoMatch) return parseInt(autoMatch[1]!, 10);
  return -1;
}

function findEventByFlatIndex(sequence: Sequence, base: EventBase, flatIdx: number): EventLocation | null {
  // Walk the content tree with a flattened counter to find the event.
  // Skip grace notes and spaces — they are not counted by the Rust layout
  // engine when assigning e{N} indices.
  let counter = 0;
  for (let i = 0; i < sequence.content.length; i++) {
    const item = sequence.content[i];
    if (!item) continue;
    if (item.type === "grace" || item.type === "space") continue;
    if ((item.type === "tuplet" || item.type === "tremolo") && item.content) {
      for (let j = 0; j < item.content.length; j++) {
        if (counter === flatIdx) return { ...base, eventIndex: j, tupletIndex: i };
        counter++;
      }
    } else {
      if (counter === flatIdx) return { ...base, eventIndex: i };
      counter++;
    }
  }
  return null;
}

/**
 * Resolve an event element ID to its location in the Score model.
 * Handles both explicit MNX IDs and auto-generated `e{N}` / `__auto_*` formats.
 * Searches inside tuplet containers for nested events.
 * Returns null if the ID is not a valid event reference.
 */
export function resolveEventLocation(elementId: string, score: Score): EventLocation | null {
  const parsed = parseEventPathSegments(elementId);
  if (!parsed) return null;
  const { base, evSuffix } = parsed;

  const sequence = score.parts[base.partIndex]?.measures[base.measureIndex]?.sequences[base.sequenceIndex];
  if (!sequence) {
    console.warn(
      `[resolveEventLocation] FAILED: sequence not found for p${base.partIndex}/m${base.measureIndex}/s${base.sequenceIndex}`,
    );
    return null;
  }

  const byId = findEventByModelId(sequence, base, evSuffix);
  if (byId) return byId;

  const flatIdx = parseFlatEventIndex(evSuffix);
  if (flatIdx >= 0) return findEventByFlatIndex(sequence, base, flatIdx);

  return null;
}

/**
 * Resolve an element ID that may include sub-element suffixes.
 * Strips suffixes like /art0, /n0, /ferm, etc. before resolving.
 */
export function resolveEventFromSubElement(elementId: string, score: Score): EventLocation | null {
  // If this is a sub-event element (art, n, ferm, trem, etc.), strip the suffix
  const parentId = getEventAncestorId(elementId);
  const loc = resolveEventLocation(parentId, score);
  if (!loc) return null;
  // Preserve per-note index so operations can target individual chord notes
  const ni = extractNoteIndex(elementId);
  if (ni !== undefined) loc.noteIndex = ni;
  return loc;
}

/**
 * Get the ancestor event ID from any element ID.
 * For event IDs, returns the ID unchanged.
 * For sub-element IDs (art0, n0, ferm, etc.), strips suffixes back to the event.
 * For non-event IDs (dyn0, tempo0, etc.), returns the ID unchanged.
 */
export function getEventAncestorId(elementId: string): string {
  const segments = elementId.split("/");
  // An event ID has format p{}/m{}/s{}/{eventSuffix}
  // Sub-elements add more segments: p{}/m{}/s{}/{eventSuffix}/art0
  if (segments.length > 4 && segments[2]?.startsWith("s")) {
    return segments.slice(0, 4).join("/");
  }
  return elementId;
}

/**
 * Parse an annotation element ID into its location.
 * Returns null if not a recognized annotation ID.
 */
export function resolveAnnotationLocation(elementId: string): AnnotationLocation | null {
  const segments = elementId.split("/");

  // Part-level: "p{part}/m{measure}/{type}{index}"
  if (segments.length === 3) {
    const partMatch = segments[0]?.match(/^p(\d+)$/);
    const measureMatch = segments[1]?.match(/^m(\d+)$/);
    if (partMatch && measureMatch) {
      const partIndex = parseInt(partMatch[1]!, 10);
      const measureIndex = parseInt(measureMatch[1]!, 10);
      const suffix = segments[2]!;

      for (const prefix of PART_ANNOTATION_PREFIXES) {
        if (suffix.startsWith(prefix)) {
          const rest = suffix.slice(prefix.length);
          const annotationIndex = rest && /^\d+$/.test(rest) ? parseInt(rest, 10) : undefined;
          return {
            kind: "part" as const,
            type: prefix,
            measureIndex,
            partIndex,
            ...(annotationIndex !== undefined && { annotationIndex }),
            ...(rest && annotationIndex === undefined && { annotationId: rest }),
          };
        }
      }
    }
  }

  // Global-level: "m{measure}/{type}" or "m{measure}/{type}{index}"
  if (segments.length === 2) {
    const measureMatch = segments[0]?.match(/^m(\d+)$/);
    if (measureMatch) {
      const measureIndex = parseInt(measureMatch[1]!, 10);
      const suffix = segments[1]!;

      for (const s of GLOBAL_ANNOTATION_SUFFIXES) {
        if (suffix.startsWith(s)) {
          const rest = suffix.slice(s.length);
          const annotationIndex = rest ? parseInt(rest, 10) : undefined;
          if (rest && isNaN(annotationIndex!)) continue;
          return {
            kind: "global" as const,
            type: s,
            measureIndex,
            ...(annotationIndex !== undefined && { annotationIndex }),
          };
        }
      }
    }
  }

  return null;
}

/**
 * True if the element id is a text annotation that engrave mode lets the user
 * click to select (so the notation-properties inspector opens). Covers part-
 * scoped text directions (`expr`, `dyn`) and global system text (`tempo`,
 * `rehearsal`).
 */
export function isEngraveTextAnnotationId(elementId: string): boolean {
  const loc = resolveAnnotationLocation(elementId);
  if (!loc) return false;
  if (loc.kind === "part") return loc.type === "expr" || loc.type === "dyn";
  return loc.type === "tempo" || loc.type === "rehearsal";
}

/**
 * True when `elementId` addresses an event or one of its noteheads — the ids a
 * delete path may act on.
 *
 * Delete paths must gate the event-level fallback on this. `resolveEventLocation`
 * reads only the first four path segments and ignores the rest, so *any* longer
 * id resolves to its event: a fingering, an augmentation dot, a lyric, or a
 * typo would all silently blank the note they sit on. Failing closed here turns
 * an unhandled sub-element into a no-op rather than data loss, and makes the
 * next independently-deletable sub-object announce itself instead of quietly
 * destroying its parent.
 *
 * A notehead passes because deleting one is meaningful — but it means removing
 * that note from its chord, not blanking the event. Callers route notehead ids
 * through `chordNoteDeletion` first and reach the event-level path only when
 * the notehead was the event's last note.
 */
export function addressesWholeEvent(elementId: string): boolean {
  const segments = elementId.split("/");
  if (segments.length === 4) return true;
  // `{event}/n{index}` — a chord note, deletable in its own right.
  return segments.length === 5 && /^n\d+$/.test(segments[4]!);
}

/**
 * Extract the note index from a notehead element ID like "p0/m0/s0/ev1/n2".
 * Returns undefined if not a notehead ID.
 */
export function extractNoteIndex(elementId: string): number | undefined {
  const match = elementId.match(/\/n(\d+)$/);
  return match ? parseInt(match[1]!, 10) : undefined;
}

/**
 * Resolved location of a grace note inside a grace container.
 * `parent` points to the regular event the grace adorns.
 */
export interface GraceLocation {
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
  /** Index of the grace container in its parent content array. */
  graceContainerIndex: number;
  /** Index of the grace note inside the grace container's content. */
  graceNoteIndex: number;
  /** If the grace container is inside a tuplet, that tuplet's index in the sequence. */
  tupletIndex?: number;
}

function graceNoteIndexInContainer(content: SequenceContent[], containerIndex: number, graceSuffix: string): number {
  const grace = content[containerIndex];
  if (!grace || grace.type !== "grace") return -1;
  const byId = grace.content.findIndex((note) => note.id === graceSuffix);
  if (byId !== -1) return byId;
  const positional = graceSuffix.match(/^e(\d+)$/);
  if (!positional) return -1;
  const index = Number.parseInt(positional[1]!, 10);
  return index >= 0 && index < grace.content.length ? index : -1;
}

/**
 * Parse a grace-note element id (`p{p}/m{m}/s{s}/{evSuffix}/grace/{graceSuffix}`).
 * `evSuffix` identifies the regular event the grace adorns; `graceSuffix` is
 * either the grace note's own id or the positional `e{N}` form. The grace
 * container itself is the immediately preceding sibling of the parent event.
 */
export function resolveGraceLocation(elementId: string, score: Score): GraceLocation | null {
  const segments = elementId.split("/");
  // Format: p{}/m{}/s{}/{evSuffix}/grace/{graceSuffix}
  if (segments.length !== 6 || segments[4] !== "grace") return null;

  const partMatch = segments[0]?.match(/^p(\d+)$/);
  const measureMatch = segments[1]?.match(/^m(\d+)$/);
  const seqMatch = segments[2]?.match(/^s(\d+)$/);
  const evSuffix = segments[3];
  const graceSuffix = segments[5];
  if (!partMatch || !measureMatch || !seqMatch || !evSuffix || !graceSuffix) return null;

  // Resolve the parent event location (handles ID, e{N}, tuplet nesting).
  const parentLoc = resolveEventLocation(`${segments[0]}/${segments[1]}/${segments[2]}/${evSuffix}`, score);
  if (!parentLoc) return null;

  const sequence =
    score.parts[parentLoc.partIndex]?.measures[parentLoc.measureIndex]?.sequences[parentLoc.sequenceIndex];
  if (!sequence) return null;

  const containerArray: SequenceContent[] | null =
    parentLoc.tupletIndex !== undefined
      ? (() => {
          const t = sequence.content[parentLoc.tupletIndex!];
          return t && t.type === "tuplet" ? (t.content as SequenceContent[]) : null;
        })()
      : sequence.content;
  if (!containerArray) return null;

  // Normal grace groups precede their principal. A trailing grace group at a
  // measure boundary has no following principal; the renderer attaches it to
  // the preceding event as `after_main`, using that event's ID.
  const candidateIndices = [parentLoc.eventIndex - 1];
  if (parentLoc.eventIndex + 1 === containerArray.length - 1) {
    candidateIndices.push(parentLoc.eventIndex + 1);
  }
  let graceContainerIndex = -1;
  let graceNoteIndex = -1;
  for (const candidateIndex of candidateIndices) {
    graceNoteIndex = graceNoteIndexInContainer(containerArray, candidateIndex, graceSuffix);
    if (graceNoteIndex !== -1) {
      graceContainerIndex = candidateIndex;
      break;
    }
  }
  if (graceContainerIndex === -1 || graceNoteIndex === -1) return null;

  return {
    partIndex: parentLoc.partIndex,
    measureIndex: parentLoc.measureIndex,
    sequenceIndex: parentLoc.sequenceIndex,
    graceContainerIndex,
    graceNoteIndex,
    ...(parentLoc.tupletIndex !== undefined && { tupletIndex: parentLoc.tupletIndex }),
  };
}

/**
 * Get a specific note event at a resolved location (returns undefined for non-event types).
 * Handles events inside tuplets via EventLocation.tupletIndex.
 */
export function getNoteEventAtLocation(score: Score, loc: EventLocation): NoteEvent | undefined {
  const ev = getEventAtLocation(score, loc);
  return ev && ev.type === "event" ? ev : undefined;
}
