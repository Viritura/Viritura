/**
 * MNX JSON Parser — main entry point.
 * Split into modules: parseGlobal, parseContent, parseParts, parseLayout
 */

import type {
  Score,
  SoundProfileAssignment,
  Support,
  ScoreMetadata,
  TextStyles,
  TimeSignatureDistribution,
  TimeSignatureGrandStaff,
  TimeSignaturePosition,
  TimeSignatureRenderStyle,
  TimeSignatureSettings,
  TimeSignatureStyles,
  VideoSyncSettings,
  VideoMediaIdentity,
  HitPoint,
} from "@viritura/core";
import { generateId } from "@viritura/core";

import type { SequenceContent } from "@viritura/core";

type Obj = Record<string, unknown>;

import { parseGlobalMeasures, parseGlobalLyrics, parseGlobalSounds } from "./parseGlobal";
import { parseParts } from "./parseParts";
import { parseLayoutDefinition, parseScoreDefinition } from "./parseLayout";
import type {
  SystemLayout as RawSystemLayout,
  Score as RawScoreDef,
  MeasureGlobal as RawMeasureGlobal,
  LyricsGlobal as RawLyricsGlobal,
  SoundsGlobal as RawSoundsGlobal,
  Part as RawPart,
} from "@viritura/core/raw";
import { DiagnosticCollector, ptr, type MnxDiagnostic } from "./diagnostics";
import { assertRawScore } from "./validator";

// ═══════════════════════════════════════════
// Main parser entry point
// ═══════════════════════════════════════════

/**
 * Options for {@link parseMnxWithDiagnostics}. Pre-alpha; backward-compatible
 * with existing callers via {@link parseMnx} which discards diagnostics.
 */
export interface ParseMnxOptions {
  /**
   * When provided, the parser writes lossy-conversion diagnostics here.
   * Inspired by standard practice importer (see
   *
   */
  diagnostics?: DiagnosticCollector;
  /**
   * Optional schema validator. When provided, the parser invokes it on the
   * raw JSON and forwards each issue to {@link diagnostics} as an error with
   * code `"schema-validation"`. The validator owns its own engine (e.g.
   * Ajv2020) so this package stays dependency-free.
   *
   * See `apps/website/src/routes/mnx-converter/ValidationPanel.tsx` for an Ajv2020 example.
   */
  validate?: (json: unknown) => ReadonlyArray<{ pointer: string; message: string }>;
}

/**
 * Result of {@link parseMnxWithDiagnostics}.
 */
export interface ParseMnxResult {
  score: Score;
  diagnostics: readonly MnxDiagnostic[];
}

/**
 * Parse a raw MNX JSON object and collect diagnostics about lossy decisions
 * (unknown fields, fallback substitutions, dropped data).
 */
export function parseMnxWithDiagnostics(json: unknown, options: ParseMnxOptions = {}): ParseMnxResult {
  const diagnostics = options.diagnostics ?? new DiagnosticCollector();
  if (options.validate) {
    for (const issue of options.validate(json)) {
      diagnostics.error(issue.pointer, issue.message, "schema-validation");
    }
  }
  const score = parseMnxInternal(json, diagnostics);
  return { score, diagnostics: diagnostics.all() };
}

/**
 * Parse a raw MNX JSON object into a typed Score model.
 *
 * Pipeline: **validate → promote**. The input is first checked against the
 * MNX JSON Schema via {@link assertRawScore}; on failure a
 * {@link RawScoreValidationFailure} is thrown with the structured error
 * list. Only after the runtime guard succeeds does the JSON flow through
 * the typed promotion stage, so every parse helper downstream is
 * guaranteed to see a schema-conformant document.
 *
 * For lenient parsing (skip the runtime guard, surface issues as
 * diagnostics instead of throwing), use {@link parseMnxWithDiagnostics}
 * directly and pass an optional `validate` callback.
 *
 * @param json - The raw JSON object (already parsed from string)
 * @returns A typed Score object
 * @throws {RawScoreValidationFailure} If the JSON does not match the MNX
 *   schema. The thrown error carries the full diagnostic list.
 */
export function parseMnx(json: unknown): Score {
  assertRawScore(json);
  return parseMnxInternal(json, new DiagnosticCollector());
}

function parseSupport(supportObj: Obj | undefined): Support | undefined {
  if (!supportObj) return undefined;
  const support: Support = {};
  if (typeof supportObj["useAccidentalDisplay"] === "boolean") {
    support.useAccidentalDisplay = supportObj["useAccidentalDisplay"];
  }
  if (typeof supportObj["useBeams"] === "boolean") {
    support.useBeams = supportObj["useBeams"];
  }
  return support;
}

function parseRootMetadata(rootX: Obj | undefined): ScoreMetadata | undefined {
  const viritura = rootX?.["viritura"] as Obj | undefined;
  const m = viritura?.["metadata"] as Obj | undefined;
  if (!m) return undefined;
  const metadata: ScoreMetadata = {};
  if (m["title"]) metadata.title = m["title"] as string;
  if (m["subtitle"]) metadata.subtitle = m["subtitle"] as string;
  if (m["composer"]) metadata.composer = m["composer"] as string;
  if (m["lyricist"]) metadata.lyricist = m["lyricist"] as string;
  if (m["arranger"]) metadata.arranger = m["arranger"] as string;
  if (m["copyright"]) metadata.copyright = m["copyright"] as string;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function parseRootTextStyles(rootX: Obj | undefined): TextStyles | undefined {
  const viritura = rootX?.["viritura"] as Obj | undefined;
  const ts = viritura?.["textStyles"] as TextStyles | undefined;
  if (!ts || typeof ts !== "object" || Object.keys(ts).length === 0) return undefined;
  return ts;
}

const RENDER_STYLES: readonly TimeSignatureRenderStyle[] = [
  "standard",
  "narrow",
  "outsideStaff",
  "singleNumber",
  "noteValue",
];
const DISTRIBUTIONS: readonly TimeSignatureDistribution[] = ["perStaff", "perGroup"];
const GRAND_STAFF_OPTIONS: readonly TimeSignatureGrandStaff[] = ["include", "exclude"];
const POSITIONS: readonly TimeSignaturePosition[] = ["center", "top", "bottom", "above"];
const SENZA_MISURA_DISPLAYS = ["open", "hidden"] as const;

const LEGACY_TIME_SIGNATURE_SETTINGS: Readonly<Record<string, TimeSignatureSettings>> = {
  normal: {},
  large: { scale: 1.5 },
  narrow: { renderStyle: "narrow" },
  aboveStaff: { position: "above", scale: 0.8 },
  spanning: { renderStyle: "outsideStaff", distribution: "perGroup", scale: 2 },
  singleNumber: { renderStyle: "singleNumber", scale: 2 },
  noteValue: { renderStyle: "noteValue" },
};

function enumValue<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return values.find((candidate) => candidate === value);
}

function parseTimeSignatureSettings(value: unknown): TimeSignatureSettings | undefined {
  if (typeof value === "string") return LEGACY_TIME_SIGNATURE_SETTINGS[value];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Obj;
  const settings: TimeSignatureSettings = {};
  const renderStyle = enumValue(RENDER_STYLES, raw["renderStyle"]);
  const distribution = enumValue(DISTRIBUTIONS, raw["distribution"]);
  const grandStaff = enumValue(GRAND_STAFF_OPTIONS, raw["grandStaff"]);
  const position = enumValue(POSITIONS, raw["position"]);
  const scale = raw["scale"];
  const senzaMisura = enumValue(SENZA_MISURA_DISPLAYS, raw["senzaMisura"]);
  if (renderStyle) settings.renderStyle = renderStyle;
  if (distribution) settings.distribution = distribution;
  if (grandStaff) settings.grandStaff = grandStaff;
  if (position) settings.position = position;
  if (typeof scale === "number" && Number.isFinite(scale)) {
    settings.scale = Math.min(12, Math.max(0.25, scale));
  }
  if (senzaMisura) settings.senzaMisura = senzaMisura;
  return settings;
}

function parseRootTimeSignatures(rootX: Obj | undefined): TimeSignatureStyles | undefined {
  const viritura = rootX?.["viritura"] as Obj | undefined;
  const raw = viritura?.["timeSignatures"] as Obj | undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const styles: TimeSignatureStyles = {};
  const score = parseTimeSignatureSettings(raw["score"]);
  const parts = parseTimeSignatureSettings(raw["parts"]);
  if (score) styles.score = score;
  if (parts) styles.parts = parts;
  return Object.keys(styles).length > 0 ? styles : undefined;
}

function parseRootSoundProfile(rootX: Obj | undefined): SoundProfileAssignment | undefined {
  const viritura = rootX?.["viritura"] as Obj | undefined;
  const assignment = viritura?.["soundProfile"] as Obj | undefined;
  if (
    !assignment ||
    typeof assignment["profileId"] !== "string" ||
    typeof assignment["profileVersion"] !== "number" ||
    !Number.isInteger(assignment["profileVersion"]) ||
    assignment["profileVersion"] < 1 ||
    !assignment["parts"] ||
    typeof assignment["parts"] !== "object"
  ) {
    return undefined;
  }

  const parts: SoundProfileAssignment["parts"] = {};
  for (const [partId, override] of Object.entries(assignment["parts"] as Obj)) {
    const raw = override as Obj | undefined;
    const sourceId = raw?.["sourceId"];
    if (typeof sourceId === "string" && sourceId.length > 0) {
      const entry: SoundProfileAssignment["parts"][string] = { sourceId };
      const profileId = raw?.["profileId"];
      if (typeof profileId === "string" && profileId.length > 0) entry.profileId = profileId;
      const profileVersion = raw?.["profileVersion"];
      if (typeof profileVersion === "number" && Number.isInteger(profileVersion) && profileVersion >= 1) {
        entry.profileVersion = profileVersion;
      }
      parts[partId] = entry;
    }
  }
  return { profileId: assignment["profileId"], profileVersion: assignment["profileVersion"], parts };
}

/**
 * Parse `_x.viritura.videoSync`.
 *
 * Validation is strict about the offset because it is the one field that
 * silently corrupts the whole feature: a non-numeric offset that defaulted to
 * zero would place every cue at the wrong frame while looking like it worked.
 * Media identity is optional — a score can remember an offset for a picture the
 * user has not relinked yet.
 */
/**
 * Parse `_x.viritura.videoSync.hitPoints`.
 *
 * Entries missing an id or a usable time are dropped rather than defaulted: a
 * hit at the wrong second is worse than a hit that is absent, because the
 * solver would silently write the cue against it.
 */
function parseHitPoints(raw: unknown): HitPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: HitPoint[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Obj;
    const id = item["id"];
    const seconds = item["pictureSeconds"];
    if (typeof id !== "string" || id.length === 0) continue;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) continue;

    const hit: HitPoint = { id, pictureSeconds: seconds };
    const label = item["label"];
    if (typeof label === "string" && label.length > 0) hit.label = label;
    if (item["locked"] === false) hit.locked = false;
    out.push(hit);
  }
  return out;
}

/** Parse the attached picture's identity, which is optional and all-or-nothing. */
function parseVideoMedia(raw: Obj | undefined): VideoMediaIdentity | undefined {
  const displayName = raw?.["displayName"];
  if (typeof displayName !== "string" || displayName.length === 0) return undefined;

  const media: VideoMediaIdentity = { displayName };
  const contentHash = raw?.["contentHash"];
  if (typeof contentHash === "string" && contentHash.length > 0) media.contentHash = contentHash;
  const demoSourceId = raw?.["demoSourceId"];
  if (typeof demoSourceId === "string" && demoSourceId.length > 0) media.demoSourceId = demoSourceId;
  const duration = raw?.["durationSeconds"];
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) media.durationSeconds = duration;
  return media;
}

function parseRootVideoSync(rootX: Obj | undefined): VideoSyncSettings | undefined {
  const viritura = rootX?.["viritura"] as Obj | undefined;
  const raw = viritura?.["videoSync"] as Obj | undefined;
  if (!raw || typeof raw !== "object") return undefined;

  const offset = raw["pictureOffsetSeconds"];
  if (typeof offset !== "number" || !Number.isFinite(offset)) return undefined;

  const version = raw["version"];
  const settings: VideoSyncSettings = {
    version: typeof version === "number" && Number.isInteger(version) && version >= 1 ? version : 1,
    pictureOffsetSeconds: offset,
    pictureAudioEnabled: raw["pictureAudioEnabled"] === true,
  };

  const startTimecode = raw["startTimecodeSeconds"];
  if (typeof startTimecode === "number" && Number.isFinite(startTimecode)) {
    settings.startTimecodeSeconds = startTimecode;
  }

  const frameRate = raw["frameRate"];
  if (typeof frameRate === "string" && frameRate.length > 0) {
    settings.frameRate = frameRate;
  }

  const hitPoints = parseHitPoints(raw["hitPoints"]);
  if (hitPoints.length > 0) settings.hitPoints = hitPoints;

  const media = parseVideoMedia(raw["media"] as Obj | undefined);
  if (media) settings.media = media;

  return settings;
}

function validateSupportConsistency(
  score: Score,
  support: Support | undefined,
  diagnostics: DiagnosticCollector,
): void {
  // mnx.support consistency checks (research §1.5):
  // The writer's `support` block declares which authored fields are present.
  // If `useBeams === true` but no measure carries beams, or
  // `useAccidentalDisplay === true` but no note carries accidentalDisplay,
  // the document is internally inconsistent — emit an info diagnostic.
  if (!support) return;
  if (support.useBeams === true) {
    const hasBeams = score.parts.some((p) => p.measures?.some((m) => Array.isArray(m.beams) && m.beams.length > 0));
    if (!hasBeams) {
      diagnostics.info(
        ptr("mnx", "support", "useBeams"),
        "mnx.support.useBeams is true but no measure carries beams; engine will auto-beam",
        "support-mismatch",
      );
    }
  }
  if (support.useAccidentalDisplay === true) {
    const hasAccDisp = score.parts.some((p) =>
      p.measures?.some((m) =>
        m.sequences?.some((seq) =>
          seq.content.some(
            (c) =>
              c.type === "event" && Array.isArray(c.notes) && c.notes.some((n) => n.accidentalDisplay !== undefined),
          ),
        ),
      ),
    );
    if (!hasAccDisp) {
      diagnostics.info(
        ptr("mnx", "support", "useAccidentalDisplay"),
        "mnx.support.useAccidentalDisplay is true but no note carries accidentalDisplay; engine will recompute",
        "support-mismatch",
      );
    }
  }
}

function parseMnxInternal(json: unknown, diagnostics: DiagnosticCollector): Score {
  const obj = json as Obj;

  if (!obj || typeof obj !== "object") {
    throw new Error("MNX: Expected a JSON object at root");
  }

  // Sanity-check for the standard top-level keys. This is deliberately a loose
  // interoperability heuristic: warn rather than rejecting the document.
  const hasStandardKeys = "mnx" in obj || "global" in obj || "parts" in obj;
  if (!hasStandardKeys) {
    diagnostics.warn(
      "",
      "Document is missing standard MNX top-level keys (mnx/global/parts); may not be a valid MNX file",
      "missing-top-level",
    );
  }

  const mnxMeta = obj["mnx"] as Obj | undefined;
  const version = (mnxMeta?.["version"] as number) ?? 1;

  // Sanity-check version. We do not enforce a minimum yet because real-world
  // MNX documents do not consistently carry a numeric version; warn on values
  // that look obviously off.
  if (mnxMeta && typeof mnxMeta["version"] !== "number") {
    diagnostics.info(ptr("mnx", "version"), "MNX `mnx.version` is not numeric; assuming 1", "non-numeric-version");
  }

  const support = parseSupport(mnxMeta?.["support"] as Obj | undefined);

  const globalObj = obj["global"] as Obj | undefined;
  const partsArr = obj["parts"] as RawPart[] | undefined;
  const layoutsArr = obj["layouts"] as unknown[] | undefined;
  const scoresArr = obj["scores"] as unknown[] | undefined;

  const score: Score = {
    mnx: support ? { version, support } : { version },
    global: {
      measures: parseGlobalMeasures(globalObj?.["measures"] as RawMeasureGlobal[] | undefined),
    },
    parts: parseParts(partsArr),
  };

  // Global lyrics
  if (globalObj?.["lyrics"]) {
    score.global.lyrics = parseGlobalLyrics(globalObj["lyrics"] as RawLyricsGlobal);
  }

  // Global sounds (drum-kit / GM sound registry)
  if (globalObj?.["sounds"]) {
    score.global.sounds = parseGlobalSounds(globalObj["sounds"] as RawSoundsGlobal);
  }

  // Layouts
  if (layoutsArr && layoutsArr.length > 0) {
    score.layouts = layoutsArr.map((l) => parseLayoutDefinition(l as RawSystemLayout));
  }

  // Scores
  if (scoresArr && scoresArr.length > 0) {
    score.scores = scoresArr.map((s) => parseScoreDefinition(s as RawScoreDef));
  }

  // Root-level vendor extensions: everything under `_x.viritura` on the
  // document root.
  applyRootExtensions(score, obj["_x"] as Obj | undefined);

  // Auto-assign IDs to any elements that lack them
  assignMissingIds(score);

  validateSupportConsistency(score, support, diagnostics);

  // Unknown-field scan (research §1.1 / §1.7). Walks the raw JSON and emits
  // an info diagnostic for any field at a known node type that this parser
  // doesn't recognize. Nested `_x` vendor dicts are skipped — by convention
  // they may carry anything.
  scanUnknownFields(obj, diagnostics);

  return score;
}

/**
 * Read the `_x.viritura` root dict onto the score.
 *
 * Split out of `parseMnxInternal` for the same reason the serializer splits
 * `serializeRootExtensions`: each extension is an independent concern, and
 * folding them back into the entry point would push it past the complexity
 * budget one root extension at a time.
 */
function applyRootExtensions(score: Score, rootX: Obj | undefined): void {
  const metadata = parseRootMetadata(rootX);
  if (metadata) score.metadata = metadata;

  const textStyles = parseRootTextStyles(rootX);
  if (textStyles) score.textStyles = textStyles;

  const timeSignatures = parseRootTimeSignatures(rootX);
  if (timeSignatures) score.timeSignatures = timeSignatures;

  const soundProfile = parseRootSoundProfile(rootX);
  if (soundProfile) score.soundProfile = soundProfile;

  const videoSync = parseRootVideoSync(rootX);
  if (videoSync) score.videoSync = videoSync;
}

/**
 * Walk the parsed score and assign IDs to any elements that lack one.
 * Preserves existing IDs from the source file. Checks for uniqueness.
 *
 * Newly minted IDs are UUID v7 — the same generator the editor uses for
 * runtime edits (`generateId()` from `@viritura/core`). Re-parsing the
 * same source file will produce *different* IDs each time, which is fine:
 * the assigned IDs are mutated into the in-memory Score and persist via
 * the normal save path. Anything depending on parse output being
 * byte-stable across runs should diff structurally or strip IDs first.
 */
function assignMissingIds(score: Score): void {
  const usedIds = new Set<string>();

  // Collect existing IDs first
  for (const gm of score.global.measures) {
    if (gm.id) usedIds.add(gm.id);
  }
  for (const part of score.parts) {
    if (part.id) usedIds.add(part.id);
    for (const pm of part.measures) {
      for (const seq of pm.sequences) {
        assignContentIds(seq.content, usedIds, true);
      }
    }
  }

  // Now assign missing IDs.
  for (const gm of score.global.measures) {
    if (!gm.id) gm.id = mintId(usedIds);
  }
  for (const part of score.parts) {
    if (!part.id) part.id = mintId(usedIds);
    for (const pm of part.measures) {
      for (const seq of pm.sequences) {
        assignContentIds(seq.content, usedIds, false);
      }
    }
  }
}

function mintId(usedIds: Set<string>): string {
  let id = generateId();
  while (usedIds.has(id)) id = generateId();
  usedIds.add(id);
  return id;
}

/**
 * Walk sequence content to collect or assign IDs on events and notes.
 * @param collectOnly - if true, only collect existing IDs; if false, assign missing ones.
 */
function assignContentIds(content: SequenceContent[], usedIds: Set<string>, collectOnly: boolean): void {
  for (const item of content) {
    if (item.type === "event") {
      processEventIds(item, usedIds, collectOnly);
    } else if (item.type === "tuplet" || item.type === "grace") {
      assignContentIds(
        item.type === "grace" ? (item.content as SequenceContent[]) : item.content,
        usedIds,
        collectOnly,
      );
    } else if (item.type === "tremolo") {
      assignContentIds(item.content as SequenceContent[], usedIds, collectOnly);
    }
  }
}

function processEventIds(
  event: Extract<SequenceContent, { type: "event" }>,
  usedIds: Set<string>,
  collectOnly: boolean,
): void {
  if (collectOnly) {
    if (event.id) usedIds.add(event.id);
    if (!event.notes) return;
    for (const n of event.notes) {
      if (n.id) usedIds.add(n.id);
    }
    return;
  }
  if (!event.id) event.id = mintId(usedIds);
  if (!event.notes) return;
  for (const n of event.notes) {
    if (!n.id) n.id = mintId(usedIds);
  }
}

// Re-export sub-parsers for direct access

// ---------------------------------------------------------------------------
// Unknown-field scan
// ---------------------------------------------------------------------------
// Per-node-type whitelists. Any other key at that location yields an info
// diagnostic so importers can surface "we silently dropped X" to users.
// _x (vendor extensions) is allowed everywhere by convention.
const KEYS = {
  root: new Set(["mnx", "global", "parts", "layouts", "scores", "_x"]),
  mnxMeta: new Set(["version", "support"]),
  support: new Set(["useAccidentalDisplay", "useBeams"]),
  global: new Set(["measures", "lyrics"]),
  globalLyrics: new Set(["lineMetadata", "lineOrder"]),
  globalMeasure: new Set([
    "id",
    "number",
    "time",
    "key",
    "barline",
    "repeatStart",
    "repeatEnd",
    "ending",
    "tempos",
    "segno",
    "fine",
    "jump",
    "_x",
  ]),
  time: new Set(["count", "unit", "display"]),
  key: new Set(["fifths", "color", "_x"]),
  barline: new Set(["type"]),
  ending: new Set(["duration", "numbers", "open", "color"]),
  tempo: new Set(["bpm", "value", "location", "_x"]),
  tempoNoteValue: new Set(["base", "dots"]),
  rhythmicPosition: new Set(["fraction"]),
  segno: new Set(["location", "glyph", "color"]),
  fine: new Set(["location", "color"]),
  jump: new Set(["type", "location"]),
  part: new Set(["id", "name", "shortName", "staves", "transposition", "measures", "_x"]),
  transposition: new Set(["interval", "keyFifthsFlipAt", "prefersWrittenPitches"]),
  partMeasure: new Set([
    "sequences",
    "clefs",
    "arpeggios",
    "nonArpeggios",
    "beams",
    "dynamics",
    "ottavas",
    "measureRepeat",
    "_x",
  ]),
  measureRepeat: new Set(["number", "counter", "displayNumber", "staffPosition", "_c", "_x"]),
  measureRepeatCounter: new Set(["count", "orient", "_c", "_x"]),
  arpeggio: new Set(["id", "position", "span", "direction", "arrow", "_c", "_x"]),
  nonArpeggio: new Set(["id", "position", "span", "_c", "_x"]),
  idPair: new Set(["start", "end"]),
  positionedClef: new Set(["clef", "position", "staff"]),
  clef: new Set(["sign", "staffPosition", "color", "glyph", "octave", "showOctave"]),
  beam: new Set(["events", "beams", "direction"]),
  dynamic: new Set(["position", "value", "glyph", "staff", "voice"]),
  ottava: new Set(["position", "end", "value", "staff", "voice"]),
  measureRhythmicPosition: new Set(["measure", "position"]),
  sequence: new Set(["content", "fullMeasure", "staff", "voice", "orient"]),
  fullMeasure: new Set(["visualDuration", "staffPosition"]),
  duration: new Set(["base", "dots"]),
  event: new Set([
    "type",
    "id",
    "duration",
    "staff",
    "orient",
    "rest",
    "notes",
    "slurs",
    "markings",
    "fermata",
    "lyrics",
    "stemDirection",
    "smufl",
    "_x",
  ]),
  rest: new Set(["staffPosition"]),
  note: new Set(["pitch", "id", "ties", "accidentalDisplay", "written"]),
  pitch: new Set(["step", "octave", "alter"]),
  tie: new Set(["target", "targetType", "side", "lv"]),
  accidentalDisplay: new Set(["show", "force", "enclosure"]),
  accidentalEnclosure: new Set(["symbol"]),
  written: new Set(["diatonicDelta"]),
  slur: new Set(["target", "side", "sideEnd", "lineType", "startNote", "endNote"]),
  markings: new Set([
    "staccato",
    "staccatissimo",
    "spiccato",
    "staccatissimoWedge",
    "tenuto",
    "accent",
    "strongAccent",
    "tremolo",
    "softAccent",
    "stress",
    "unstress",
    "breath",
    "bowDirection",
    "_x",
  ]),
  tuplet: new Set(["type", "inner", "outer", "content", "bracket", "showNumber", "showValue", "orient"]),
  tupletDuration: new Set(["duration", "multiple"]),
  grace: new Set(["type", "content", "graceType", "slash", "color"]),
  multiTremolo: new Set(["type", "content", "marks", "outer"]),
  space: new Set(["type", "duration"]),
  layoutDefinition: new Set(["id", "content"]),
  layoutGroup: new Set(["type", "content", "symbol", "label", "barlineStyle"]),
  layoutStaff: new Set(["type", "sources", "label", "labelref"]),
  layoutSource: new Set(["part", "staff", "stem", "voice", "labelref"]),
  scoreDefinition: new Set(["name", "layout", "multimeasureRests", "pages", "useWritten", "_x"]),
  multimeasureRest: new Set(["start", "duration"]),
  page: new Set(["systems"]),
  system: new Set(["measure", "layout", "layoutChanges"]),
  layoutChange: new Set(["layout", "location"]),
};

function scanUnknownFields(json: unknown, dx: DiagnosticCollector): void {
  if (!json || typeof json !== "object") return;
  const root = json as Obj;
  emitUnknown(root, KEYS.root, "", dx);

  const mnxMeta = root["mnx"];
  if (mnxMeta && typeof mnxMeta === "object") {
    emitUnknown(mnxMeta as Obj, KEYS.mnxMeta, ptr("mnx"), dx);
    const support = (mnxMeta as Obj)["support"];
    if (support && typeof support === "object") {
      emitUnknown(support as Obj, KEYS.support, ptr("mnx", "support"), dx);
    }
  }

  const global = root["global"];
  if (global && typeof global === "object") {
    emitUnknown(global as Obj, KEYS.global, ptr("global"), dx);
    const measures = (global as Obj)["measures"];
    if (Array.isArray(measures)) {
      measures.forEach((gm, i) => scanGlobalMeasure(gm as Obj, ptr("global", "measures", i), dx));
    }
  }

  const parts = root["parts"];
  if (Array.isArray(parts)) {
    parts.forEach((p, i) => scanPart(p as Obj, ptr("parts", i), dx));
  }

  const layouts = root["layouts"];
  if (Array.isArray(layouts)) {
    layouts.forEach((l, i) => scanLayout(l as Obj, ptr("layouts", i), dx));
  }

  const scores = root["scores"];
  if (Array.isArray(scores)) {
    scores.forEach((s, i) => {
      if (s && typeof s === "object") {
        emitUnknown(s as Obj, KEYS.scoreDefinition, ptr("scores", i), dx);
      }
    });
  }
}

function emitUnknown(obj: Obj, allowed: Set<string>, parentPtr: string, dx: DiagnosticCollector): void {
  for (const k of Object.keys(obj)) {
    if (allowed.has(k)) continue;
    if (k.startsWith("_")) continue; // _x and friends are vendor-private
    dx.info(parentPtr + ptr(k), `Unknown field "${k}" dropped during MNX parse`, "unknown-field");
  }
}

function scanGlobalMeasure(gm: Obj, p: string, dx: DiagnosticCollector): void {
  if (!gm || typeof gm !== "object") return;
  emitUnknown(gm, KEYS.globalMeasure, p, dx);
  const time = gm["time"] as Obj | undefined;
  if (time) emitUnknown(time, KEYS.time, p + ptr("time"), dx);
  const key = gm["key"] as Obj | undefined;
  if (key) emitUnknown(key, KEYS.key, p + ptr("key"), dx);
  const barline = gm["barline"] as Obj | undefined;
  if (barline) emitUnknown(barline, KEYS.barline, p + ptr("barline"), dx);
  const ending = gm["ending"] as Obj | undefined;
  if (ending) emitUnknown(ending, KEYS.ending, p + ptr("ending"), dx);
  const tempos = gm["tempos"];
  if (Array.isArray(tempos)) {
    tempos.forEach((t, i) => {
      if (t && typeof t === "object") {
        emitUnknown(t as Obj, KEYS.tempo, p + ptr("tempos", i), dx);
      }
    });
  }
  const segno = gm["segno"] as Obj | undefined;
  if (segno) emitUnknown(segno, KEYS.segno, p + ptr("segno"), dx);
  const fine = gm["fine"] as Obj | undefined;
  if (fine) emitUnknown(fine, KEYS.fine, p + ptr("fine"), dx);
  const jump = gm["jump"] as Obj | undefined;
  if (jump) emitUnknown(jump, KEYS.jump, p + ptr("jump"), dx);
}

function scanPart(part: Obj, p: string, dx: DiagnosticCollector): void {
  if (!part || typeof part !== "object") return;
  emitUnknown(part, KEYS.part, p, dx);
  const trans = part["transposition"] as Obj | undefined;
  if (trans) emitUnknown(trans, KEYS.transposition, p + ptr("transposition"), dx);
  const measures = part["measures"];
  if (Array.isArray(measures)) {
    measures.forEach((pm, i) => scanPartMeasure(pm as Obj, p + ptr("measures", i), dx));
  }
}

function scanPartMeasure(pm: Obj, p: string, dx: DiagnosticCollector): void {
  if (!pm || typeof pm !== "object") return;
  emitUnknown(pm, KEYS.partMeasure, p, dx);
  const sequences = pm["sequences"];
  if (Array.isArray(sequences)) {
    sequences.forEach((s, i) => scanSequence(s as Obj, p + ptr("sequences", i), dx));
  }
  const beams = pm["beams"];
  if (Array.isArray(beams)) {
    beams.forEach((b, i) => {
      if (b && typeof b === "object") {
        emitUnknown(b as Obj, KEYS.beam, p + ptr("beams", i), dx);
      }
    });
  }
  const arpeggios = pm["arpeggios"];
  if (Array.isArray(arpeggios)) {
    arpeggios.forEach((a, i) => scanArpeggioObject(a as Obj, p + ptr("arpeggios", i), dx));
  }
  const nonArpeggios = pm["nonArpeggios"];
  if (Array.isArray(nonArpeggios)) {
    nonArpeggios.forEach((a, i) => scanNonArpeggioObject(a as Obj, p + ptr("nonArpeggios", i), dx));
  }
  const measureRepeat = pm["measureRepeat"] as Obj | undefined;
  if (measureRepeat && typeof measureRepeat === "object") {
    emitUnknown(measureRepeat, KEYS.measureRepeat, p + ptr("measureRepeat"), dx);
    const counter = measureRepeat["counter"] as Obj | undefined;
    if (counter && typeof counter === "object") {
      emitUnknown(counter, KEYS.measureRepeatCounter, p + ptr("measureRepeat") + ptr("counter"), dx);
    }
  }
}

function scanArpeggioObject(obj: Obj, p: string, dx: DiagnosticCollector): void {
  if (!obj || typeof obj !== "object") return;
  emitUnknown(obj, KEYS.arpeggio, p, dx);
  const position = obj["position"] as Obj | undefined;
  if (position) emitUnknown(position, KEYS.rhythmicPosition, p + ptr("position"), dx);
  const span = obj["span"] as Obj | undefined;
  if (span) emitUnknown(span, KEYS.idPair, p + ptr("span"), dx);
}

function scanNonArpeggioObject(obj: Obj, p: string, dx: DiagnosticCollector): void {
  if (!obj || typeof obj !== "object") return;
  emitUnknown(obj, KEYS.nonArpeggio, p, dx);
  const position = obj["position"] as Obj | undefined;
  if (position) emitUnknown(position, KEYS.rhythmicPosition, p + ptr("position"), dx);
  const span = obj["span"] as Obj | undefined;
  if (span) emitUnknown(span, KEYS.idPair, p + ptr("span"), dx);
}

function scanSequence(seq: Obj, p: string, dx: DiagnosticCollector): void {
  if (!seq || typeof seq !== "object") return;
  emitUnknown(seq, KEYS.sequence, p, dx);
  const content = seq["content"];
  if (Array.isArray(content)) {
    content.forEach((c, i) => scanContentItem(c as Obj, p + ptr("content", i), dx));
  }
}

function scanContentItem(c: Obj, p: string, dx: DiagnosticCollector): void {
  if (!c || typeof c !== "object") return;
  // MNX `type` is required on tuplet/grace/space/tremolo, but optional on event
  // (event is the default content kind when no discriminator is present).
  const type = c["type"] ?? "event";
  if (type === "event") {
    emitUnknown(c, KEYS.event, p, dx);
    const notes = c["notes"];
    if (Array.isArray(notes)) {
      notes.forEach((n, i) => {
        if (n && typeof n === "object") {
          emitUnknown(n as Obj, KEYS.note, p + ptr("notes", i), dx);
        }
      });
    }
    const markings = c["markings"] as Obj | undefined;
    if (markings) emitUnknown(markings, KEYS.markings, p + ptr("markings"), dx);
  } else if (type === "tuplet") {
    emitUnknown(c, KEYS.tuplet, p, dx);
    const inner = c["content"];
    if (Array.isArray(inner)) {
      inner.forEach((ci, i) => scanContentItem(ci as Obj, p + ptr("content", i), dx));
    }
  } else if (type === "grace") {
    emitUnknown(c, KEYS.grace, p, dx);
    const inner = c["content"];
    if (Array.isArray(inner)) {
      inner.forEach((ci, i) => scanContentItem(ci as Obj, p + ptr("content", i), dx));
    }
  } else if (type === "tremolo") {
    emitUnknown(c, KEYS.multiTremolo, p, dx);
    const inner = c["content"];
    if (Array.isArray(inner)) {
      inner.forEach((ci, i) => scanContentItem(ci as Obj, p + ptr("content", i), dx));
    }
  } else if (type === "space") {
    emitUnknown(c, KEYS.space, p, dx);
  }
}

function scanLayout(l: Obj, p: string, dx: DiagnosticCollector): void {
  if (!l || typeof l !== "object") return;
  emitUnknown(l, KEYS.layoutDefinition, p, dx);
  const content = l["content"];
  if (Array.isArray(content)) {
    content.forEach((it, i) => scanLayoutItem(it as Obj, p + ptr("content", i), dx));
  }
}

function scanLayoutItem(it: Obj, p: string, dx: DiagnosticCollector): void {
  if (!it || typeof it !== "object") return;
  const type = it["type"];
  if (type === "group") {
    emitUnknown(it, KEYS.layoutGroup, p, dx);
    const inner = it["content"];
    if (Array.isArray(inner)) {
      inner.forEach((ci, i) => scanLayoutItem(ci as Obj, p + ptr("content", i), dx));
    }
  } else if (type === "staff") {
    emitUnknown(it, KEYS.layoutStaff, p, dx);
    const sources = it["sources"];
    if (Array.isArray(sources)) {
      sources.forEach((s, i) => {
        if (s && typeof s === "object") {
          emitUnknown(s as Obj, KEYS.layoutSource, p + ptr("sources", i), dx);
        }
      });
    }
  }
}
