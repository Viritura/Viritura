// MNX Parser — parseLayout (split from parser.ts)
//
// Consumes the generated Raw* wire types from @viritura/core/raw and produces
// the decoded model from @viritura/core. Field access is now type-checked
// against the MNX schema; schema drift surfaces as compile errors here.
//
// Vendor-extension access (`_x.viritura.*`) still requires casts because
// the schema deliberately leaves vendor dicts untyped — see
// docs/spec/viritura-extensions.md for the typed shapes we layer on top.

import type {
  LayoutDefinition,
  LayoutContent,
  LayoutGroup,
  LayoutStaff,
  LayoutSource,
  ScoreDefinition,
  PageDefinition,
  SystemDefinition,
  LayoutChange,
  MultimeasureRestRange,
  PageSetupOverride,
  PageTurnSettings,
  InstrumentNameDisplaySettings,
  BarNumberSettings,
  AutoHideEmptyStavesOptions,
} from "@viritura/core";
import { parseTextFrames } from "./parseTextFrames";

import type {
  SystemLayout as RawSystemLayout,
  StaffGroup as RawStaffGroup,
  Staff as RawStaff,
  StaffSource as RawStaffSource,
  Score as RawScoreDef,
  Page as RawPage,
  System as RawSystem,
  LayoutChange as RawLayoutChange,
  MultimeasureRest as RawMultimeasureRest,
} from "@viritura/core/raw";

// ═══════════════════════════════════════════
// MNX Layout definitions
// ═══════════════════════════════════════════

export function parseLayoutDefinition(raw: RawSystemLayout): LayoutDefinition {
  const ld: LayoutDefinition = {
    // `id` is optional in the schema (every global-attrs has optional id);
    // assignMissingIds() later fills any gaps. Preserve undefined here.
    id: raw.id as string,
    content: raw.content.map(parseLayoutContent),
  };

  // Vendor extension: _x.viritura.derived — flags auto-derived layouts
  // (e.g. hide-staff prunes) so the GC can distinguish them from
  // user-authored layouts.
  const viritura = raw._x?.["viritura"] as Record<string, unknown> | undefined;
  if (viritura?.["derived"] === true) {
    ld._x = { viritura: { derived: true } };
  }

  return ld;
}

function parseLayoutContent(raw: RawStaffGroup | RawStaff): LayoutContent {
  if (raw.type === "group") return parseLayoutGroup(raw);
  return parseLayoutStaff(raw);
}

function parseLayoutGroup(raw: RawStaffGroup): LayoutGroup {
  const group: LayoutGroup = {
    type: "group",
    content: raw.content.map(parseLayoutContent),
  };
  if (raw.symbol) group.symbol = raw.symbol;
  if (raw.label !== undefined) group.label = raw.label;
  if (raw.labelRef) group.labelRef = raw.labelRef;
  if (raw.barlineStyle) group.barlineStyle = raw.barlineStyle;
  const viritura = raw._x?.["viritura"] as Record<string, unknown> | undefined;
  if (typeof viritura?.["showGroupName"] === "boolean") group.showGroupName = viritura["showGroupName"];
  return group;
}

function parseLayoutStaff(raw: RawStaff): LayoutStaff {
  const staff: LayoutStaff = {
    type: "staff",
    sources: (raw.sources ?? []).map(parseLayoutSource),
  };
  if (raw.label !== undefined) staff.label = raw.label;
  if (raw.labelRef) staff.labelRef = raw.labelRef;
  if (raw.symbol) staff.symbol = raw.symbol;
  return staff;
}

function parseLayoutSource(raw: RawStaffSource): LayoutSource {
  const src: LayoutSource = {
    part: raw.part,
  };
  if (raw.staff !== undefined) src.staff = raw.staff;
  if (raw.stem) src.stem = raw.stem;
  if (raw.voice) src.voice = raw.voice;
  if (raw.label !== undefined) src.label = raw.label;
  if (raw.labelRef) src.labelRef = raw.labelRef;
  return src;
}

// ═══════════════════════════════════════════
// MNX Score definitions
// ═══════════════════════════════════════════

function isUniqueIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((id): id is string => typeof id === "string" && id.length > 0) &&
    new Set(value).size === value.length
  );
}

function parseAutoHideEmptyStaves(value: unknown): AutoHideEmptyStavesOptions | undefined {
  if (value === undefined) return undefined;
  const invalid = () => new Error("Viritura autoHideEmptyStaves must contain firstSystem and keepVisible entries.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const raw = value as Record<string, unknown>;
  const options: AutoHideEmptyStavesOptions = {};
  if (raw["firstSystem"] !== undefined) {
    if (raw["firstSystem"] !== "hide" && raw["firstSystem"] !== "show") throw invalid();
    options.firstSystem = raw["firstSystem"];
  }
  if (raw["keepVisible"] !== undefined) {
    if (!Array.isArray(raw["keepVisible"])) throw invalid();
    options.keepVisible = raw["keepVisible"].map((entry: unknown) => {
      const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const measure = record["measure"];
      const parts = record["parts"];
      if (typeof measure !== "string" || measure.length === 0 || !isUniqueIdList(parts) || parts.length === 0) {
        throw invalid();
      }
      return { measure, parts: [...parts] };
    });
  }
  return options;
}

// eslint-disable-next-line complexity -- MNX score definitions flatten several independent optional vendor fields
export function parseScoreDefinition(raw: RawScoreDef): ScoreDefinition {
  const sd: ScoreDefinition = {};
  if (raw.name) sd.name = raw.name;
  if (raw.layout) sd.layout = raw.layout;
  if (raw.multimeasureRests && raw.multimeasureRests.length > 0) {
    sd.multimeasureRests = raw.multimeasureRests.map((m: RawMultimeasureRest): MultimeasureRestRange => ({
      start: m.start,
      duration: m.duration,
    }));
  }
  if (raw.pages && raw.pages.length > 0) {
    sd.pages = raw.pages.map(parsePageDefinition);
  }
  if (raw.useWritten !== undefined) sd.useWritten = raw.useWritten;

  // Vendor extension: _x.viritura.pageSetup
  // (vendor dicts are untyped in the schema; narrow-cast the known shape.)
  const viritura = raw._x?.["viritura"] as Record<string, unknown> | undefined;
  if (viritura && "textFrames" in viritura) sd.textFrames = parseTextFrames(viritura["textFrames"]);
  if (viritura?.["barNumbers"]) sd.barNumbers = { ...(viritura["barNumbers"] as BarNumberSettings) };
  if (viritura && "autoHideEmptyParts" in viritura) {
    const parts = viritura["autoHideEmptyParts"];
    if (
      !Array.isArray(parts) ||
      !parts.every((part): part is string => typeof part === "string" && part.length > 0) ||
      new Set(parts).size !== parts.length
    ) {
      throw new Error("Viritura autoHideEmptyParts must be an array of unique, nonempty part IDs.");
    }
    sd.autoHideEmptyParts = [...parts];
  }
  const autoHideOptions = parseAutoHideEmptyStaves(viritura?.["autoHideEmptyStaves"]);
  if (autoHideOptions) sd.autoHideEmptyStaves = autoHideOptions;
  const labelsRaw = viritura?.["instrumentNameDisplay"] as Record<string, unknown> | undefined;
  if (labelsRaw) {
    sd.instrumentNameDisplay = {
      firstSystem: labelsRaw["firstSystem"] as InstrumentNameDisplaySettings["firstSystem"],
      subsequentSystems: labelsRaw["subsequentSystems"] as InstrumentNameDisplaySettings["subsequentSystems"],
    };
  }
  const layoutBreaksRaw = viritura?.["layoutBreaks"];
  if (Array.isArray(layoutBreaksRaw)) {
    sd.layoutBreaks = layoutBreaksRaw.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const entry = value as Record<string, unknown>;
      if (typeof entry["measure"] !== "string") return [];
      if (entry["kind"] !== "system" && entry["kind"] !== "page") return [];
      return [{ measure: entry["measure"], kind: entry["kind"] }];
    });
  }
  const psRaw = viritura?.["pageSetup"] as Record<string, unknown> | undefined;
  const role = viritura?.["pageSetupRole"];
  if (role === "score" || role === "part") sd.pageSetupRole = role;
  const layoutProfile = viritura?.["layoutProfile"];
  if (typeof layoutProfile === "string" && layoutProfile.length > 0) sd.layoutProfile = layoutProfile;
  const pageSetup = psRaw ? parsePageSetupOverride(psRaw) : undefined;
  if (pageSetup) sd.pageSetup = pageSetup;

  return sd;
}

function parsePageSetupOverride(psRaw: Record<string, unknown>): PageSetupOverride | undefined {
  const pageSetup: PageSetupOverride = {};
  if (psRaw["width"] !== undefined) pageSetup.width = psRaw["width"] as number;
  if (psRaw["height"] !== undefined) pageSetup.height = psRaw["height"] as number;
  if (psRaw["orientation"]) pageSetup.orientation = psRaw["orientation"] as "portrait" | "landscape";
  if (psRaw["margins"]) {
    const m = psRaw["margins"] as Record<string, unknown>;
    const margins: NonNullable<PageSetupOverride["margins"]> = {};
    for (const side of ["top", "right", "bottom", "left"] as const) {
      if (typeof m[side] === "number") margins[side] = m[side];
    }
    if (Object.keys(margins).length > 0) pageSetup.margins = margins;
  }
  if (psRaw["spatiumMm"] !== undefined) pageSetup.spatiumMm = psRaw["spatiumMm"] as number;
  const ptRaw = psRaw["pageTurns"] as Record<string, unknown> | undefined;
  if (ptRaw && ptRaw["enabled"] !== undefined) pageSetup.pageTurns = parsePageTurns(ptRaw);
  return Object.keys(pageSetup).length > 0 ? pageSetup : undefined;
}

function parsePageTurns(ptRaw: Record<string, unknown>): PageTurnSettings {
  const pageTurns: PageTurnSettings = {
    enabled: ptRaw["enabled"] as boolean,
    ...(ptRaw["preset"] ? { preset: ptRaw["preset"] as "relaxed" | "professional" } : {}),
    ...(ptRaw["comfortableSecs"] !== undefined ? { comfortableSecs: ptRaw["comfortableSecs"] as number } : {}),
    ...(ptRaw["vsSecs"] !== undefined ? { vsSecs: ptRaw["vsSecs"] as number } : {}),
    ...(ptRaw["minAcceptableSecs"] !== undefined ? { minAcceptableSecs: ptRaw["minAcceptableSecs"] as number } : {}),
    ...(ptRaw["targetFillFraction"] !== undefined ? { targetFillFraction: ptRaw["targetFillFraction"] as number } : {}),
    ...(ptRaw["minFillFraction"] !== undefined ? { minFillFraction: ptRaw["minFillFraction"] as number } : {}),
    ...(ptRaw["verticalJustifyThreshold"] !== undefined
      ? { verticalJustifyThreshold: ptRaw["verticalJustifyThreshold"] as number }
      : {}),
    ...(ptRaw["allowPartialPages"] !== undefined ? { allowPartialPages: ptRaw["allowPartialPages"] as boolean } : {}),
    ...(ptRaw["allowIntentionalBlanks"] !== undefined
      ? { allowIntentionalBlanks: ptRaw["allowIntentionalBlanks"] as boolean }
      : {}),
    ...(ptRaw["titlePage"] ? { titlePage: ptRaw["titlePage"] as PageTurnSettings["titlePage"] } : {}),
    ...(ptRaw["firstPageRecto"] !== undefined ? { firstPageRecto: ptRaw["firstPageRecto"] as boolean } : {}),
    ...(ptRaw["emitVsMarks"] !== undefined ? { emitVsMarks: ptRaw["emitVsMarks"] as boolean } : {}),
    ...(ptRaw["defaultBpm"] !== undefined ? { defaultBpm: ptRaw["defaultBpm"] as number } : {}),
  };
  const weightsRaw = ptRaw["weights"] as Record<string, unknown> | undefined;
  if (weightsRaw) pageTurns.weights = parsePageTurnWeights(weightsRaw);
  return pageTurns;
}

function parsePageTurnWeights(weightsRaw: Record<string, unknown>): NonNullable<PageTurnSettings["weights"]> {
  return {
    ...(weightsRaw["density"] !== undefined ? { density: weightsRaw["density"] as number } : {}),
    ...(weightsRaw["turn"] !== undefined ? { turn: weightsRaw["turn"] as number } : {}),
    ...(weightsRaw["sparse"] !== undefined ? { sparse: weightsRaw["sparse"] as number } : {}),
    ...(weightsRaw["titlePage"] !== undefined ? { titlePage: weightsRaw["titlePage"] as number } : {}),
    ...(weightsRaw["blankPage"] !== undefined ? { blankPage: weightsRaw["blankPage"] as number } : {}),
    ...(weightsRaw["timeMarking"] !== undefined ? { timeMarking: weightsRaw["timeMarking"] as number } : {}),
  };
}

function parsePageDefinition(raw: RawPage): PageDefinition {
  return {
    systems: (raw.systems ?? []).map(parseSystemDefinition),
  };
}

function parseSystemDefinition(raw: RawSystem): SystemDefinition {
  const sd: SystemDefinition = {
    measure: raw.measure,
  };
  if (raw.layout) sd.layout = raw.layout;
  if (raw.layoutChanges && raw.layoutChanges.length > 0) {
    sd.layoutChanges = raw.layoutChanges.map((lc: RawLayoutChange): LayoutChange => ({
      layout: lc.layout,
      location: {
        measure: lc.location.measure,
        ...(lc.location.position
          ? {
              position: {
                // Schema types fraction as integer-unsigned[]; the decoded
                // model uses a [num, den] tuple. Narrow array→tuple here.
                fraction: lc.location.position.fraction as [number, number],
              },
            }
          : {}),
      },
    }));
  }
  return sd;
}
