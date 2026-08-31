/**
 * MNX Serializer — layout & score definitions.
 * Split out of serializer.ts to stay under the 600-line budget.
 */

import type { LayoutDefinition, LayoutContent, LayoutGroup, LayoutStaff, ScoreDefinition } from "@viritura/core";
import { DEFAULT_PAGE_SETUP } from "@viritura/core";

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

  // Vendor extension: _x.viritura.pageSetup — only write non-default values
  if (sd.pageSetup) {
    const psObj = serializePageSetup(sd.pageSetup);
    if (Object.keys(psObj).length > 0) {
      obj["_x"] = { viritura: { pageSetup: psObj } };
    }
  }

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
  const d = DEFAULT_PAGE_SETUP;
  const psObj: Obj = {};
  if (ps.width !== d.width) psObj["width"] = ps.width;
  if (ps.height !== d.height) psObj["height"] = ps.height;
  if (ps.orientation !== d.orientation) psObj["orientation"] = ps.orientation;
  if (ps.spatiumMm !== d.spatiumMm) psObj["spatiumMm"] = ps.spatiumMm;
  if (
    ps.margins &&
    (ps.margins.top !== d.margins.top ||
      ps.margins.right !== d.margins.right ||
      ps.margins.bottom !== d.margins.bottom ||
      ps.margins.left !== d.margins.left)
  ) {
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
