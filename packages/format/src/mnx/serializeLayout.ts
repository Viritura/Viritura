/**
 * MNX Serializer — layout & score definitions.
 * Split out of serializer.ts to stay under the 600-line budget.
 */

import type { LayoutDefinition, LayoutContent, LayoutGroup, LayoutStaff, ScoreDefinition } from "@viritura/core";

type Obj = Record<string, unknown>;

// ═══════════════════════════════════════════
// MNX Layout definitions
// ═══════════════════════════════════════════

export function serializeLayoutDefinition(ld: LayoutDefinition): Obj {
  const obj: Obj = {
    id: ld.id,
    content: ld.content.map(serializeLayoutContent),
  };
  if (ld._x?.viritura?.derived === true) {
    obj["_x"] = { viritura: { derived: true } };
  }
  return obj;
}

function serializeLayoutContent(lc: LayoutContent): Obj {
  if (lc.type === "group") return serializeLayoutGroup(lc);
  return serializeLayoutStaff(lc);
}

function serializeLayoutGroup(g: LayoutGroup): Obj {
  const obj: Obj = {
    type: "group",
  };
  if (g.barlineStyle) obj["barlineStyle"] = g.barlineStyle;
  obj["content"] = g.content.map(serializeLayoutContent);
  if (g.label) obj["label"] = g.label;
  if (g.symbol) obj["symbol"] = g.symbol;
  return obj;
}

function serializeLayoutStaff(s: LayoutStaff): Obj {
  const obj: Obj = { type: "staff" };
  if (s.label) obj["label"] = s.label;
  if (s.labelref) obj["labelref"] = s.labelref;
  obj["sources"] = s.sources.map((src) => {
    const srcObj: Obj = { part: src.part };
    if (src.staff !== undefined) srcObj["staff"] = src.staff;
    if (src.stem) srcObj["stem"] = src.stem;
    if (src.voice) srcObj["voice"] = src.voice;
    if (src.labelref) srcObj["labelref"] = src.labelref;
    return srcObj;
  });
  return obj;
}

// ═══════════════════════════════════════════
// MNX Score definitions
// ═══════════════════════════════════════════

export function serializeScoreDefinition(sd: ScoreDefinition): Obj {
  const obj: Obj = {};
  // `name` is required by the MNX schema and the engine's `raw::Score`
  // (deserialization fails with "missing field `name`" otherwise). Always
  // emit it, falling back to the layout id or an empty string when a score
  // reaches us without one (e.g. externally-authored or legacy MNX files).
  obj["name"] = sd.name ?? sd.layout ?? "";
  if (sd.layout) obj["layout"] = sd.layout;
  if (sd.multimeasureRests && sd.multimeasureRests.length > 0) {
    obj["multimeasureRests"] = sd.multimeasureRests.map((m) => ({
      start: m.start,
      duration: m.duration,
    }));
  }
  if (sd.pages && sd.pages.length > 0) {
    obj["pages"] = sd.pages.map(serializePage);
  }
  if (sd.useWritten !== undefined) obj["useWritten"] = sd.useWritten;

  const viritura: Obj = {};
  if (sd.pageSetupRole) viritura["pageSetupRole"] = sd.pageSetupRole;
  if (sd.instrumentNameDisplay) {
    viritura["instrumentNameDisplay"] = { ...sd.instrumentNameDisplay };
  }
  if (sd.autoHideEmptyParts !== undefined) {
    viritura["autoHideEmptyParts"] = [...sd.autoHideEmptyParts];
  }
  if (sd.layoutBreaks && sd.layoutBreaks.length > 0) {
    viritura["layoutBreaks"] = sd.layoutBreaks.map((entry) => ({ ...entry }));
  }
  if (sd.textFrames) {
    viritura["textFrames"] = sd.textFrames.map(serializeTextFrame);
  }

  // Explicit values must survive even when equal to built-in defaults:
  // they may override a different project default.
  if (sd.pageSetup) {
    const psObj = serializePageSetup(sd.pageSetup);
    if (Object.keys(psObj).length > 0) {
      viritura["pageSetup"] = psObj;
    }
  }
  if (Object.keys(viritura).length > 0) obj["_x"] = { viritura };

  return obj;
}

function serializeTextFrame(frame: NonNullable<ScoreDefinition["textFrames"]>[number]): Obj {
  const obj: Obj = {
    id: frame.id,
    locator: { ...frame.locator },
    placement: {
      anchor: frame.placement.anchor,
      offset: { ...frame.placement.offset },
    },
    width: { ...frame.width },
    content: frame.content,
  };
  if (frame.horizontalAlignment !== undefined) obj["horizontalAlignment"] = frame.horizontalAlignment;
  if (frame.paragraphJustification !== undefined) obj["paragraphJustification"] = frame.paragraphJustification;
  if (frame.padding !== undefined) obj["padding"] = frame.padding;
  if (frame.border !== undefined) obj["border"] = frame.border;
  if (frame.eraseBackground !== undefined) obj["eraseBackground"] = frame.eraseBackground;
  if (frame.sourceReference) obj["sourceReference"] = { ...frame.sourceReference };
  if (frame.staffAttachment) obj["staffAttachment"] = frame.staffAttachment;
  return obj;
}

function serializePage(p: NonNullable<ScoreDefinition["pages"]>[number]): Obj {
  return { systems: p.systems.map(serializeSystem) };
}

function serializeSystem(s: NonNullable<ScoreDefinition["pages"]>[number]["systems"][number]): Obj {
  const sObj: Obj = {};
  if (s.layout) sObj["layout"] = s.layout;
  if (s.layoutChanges && s.layoutChanges.length > 0) {
    sObj["layoutChanges"] = s.layoutChanges.map((lc) => ({
      layout: lc.layout,
      location: {
        measure: lc.location.measure,
        ...(lc.location.position ? { position: { fraction: lc.location.position.fraction } } : {}),
      },
    }));
  }
  sObj["measure"] = s.measure;
  return sObj;
}

function serializePageSetup(ps: NonNullable<ScoreDefinition["pageSetup"]>): Obj {
  const psObj: Obj = {};
  if (ps.width !== undefined) psObj["width"] = ps.width;
  if (ps.height !== undefined) psObj["height"] = ps.height;
  if (ps.orientation !== undefined) psObj["orientation"] = ps.orientation;
  if (ps.spatiumMm !== undefined) psObj["spatiumMm"] = ps.spatiumMm;
  if (ps.margins) {
    psObj["margins"] = {
      top: ps.margins.top,
      right: ps.margins.right,
      bottom: ps.margins.bottom,
      left: ps.margins.left,
    };
  }
  if (ps.pageTurns) {
    psObj["pageTurns"] = {
      enabled: ps.pageTurns.enabled,
      ...(ps.pageTurns.preset ? { preset: ps.pageTurns.preset } : {}),
      ...(ps.pageTurns.comfortableSecs !== undefined ? { comfortableSecs: ps.pageTurns.comfortableSecs } : {}),
      ...(ps.pageTurns.vsSecs !== undefined ? { vsSecs: ps.pageTurns.vsSecs } : {}),
      ...(ps.pageTurns.minAcceptableSecs !== undefined ? { minAcceptableSecs: ps.pageTurns.minAcceptableSecs } : {}),
      ...(ps.pageTurns.targetFillFraction !== undefined ? { targetFillFraction: ps.pageTurns.targetFillFraction } : {}),
      ...(ps.pageTurns.minFillFraction !== undefined ? { minFillFraction: ps.pageTurns.minFillFraction } : {}),
      ...(ps.pageTurns.verticalJustifyThreshold !== undefined
        ? { verticalJustifyThreshold: ps.pageTurns.verticalJustifyThreshold }
        : {}),
      ...(ps.pageTurns.allowPartialPages !== undefined ? { allowPartialPages: ps.pageTurns.allowPartialPages } : {}),
      ...(ps.pageTurns.allowIntentionalBlanks !== undefined
        ? { allowIntentionalBlanks: ps.pageTurns.allowIntentionalBlanks }
        : {}),
      ...(ps.pageTurns.titlePage !== undefined ? { titlePage: ps.pageTurns.titlePage } : {}),
      ...(ps.pageTurns.firstPageRecto !== undefined ? { firstPageRecto: ps.pageTurns.firstPageRecto } : {}),
      ...(ps.pageTurns.emitVsMarks !== undefined ? { emitVsMarks: ps.pageTurns.emitVsMarks } : {}),
      ...(ps.pageTurns.defaultBpm !== undefined ? { defaultBpm: ps.pageTurns.defaultBpm } : {}),
      ...(ps.pageTurns.weights ? { weights: { ...ps.pageTurns.weights } } : {}),
    };
  }
  return psObj;
}
