import { RASTRAL_SPATIUM_MM, type PageSetup, type PageSetupOverride, type Score } from "@viritura/core";
import { findPageSizeName, formatMm } from "../components/pageSetupHelpers";
import {
  layoutProfileScope,
  layoutsUsingProfile,
  readPageLayer,
  resolvedPageSetup,
  writePageLayer,
  type LayoutScope,
  type PageScope,
  type ProfileScope,
} from "./pageScope";

type PageFieldId = "pageSize" | "staffSize" | "marginTop" | "marginBottom" | "marginLeft" | "marginRight" | "pageTurns";

type Side = "top" | "bottom" | "left" | "right";

export interface PageFieldDefinition {
  id: PageFieldId;
  label: string;
  /** Only this field's values from a sparse layer. */
  pick: (layer: PageSetupOverride) => PageSetupOverride;
  /** The layer without this field's values. */
  omit: (layer: PageSetupOverride) => PageSetupOverride;
  format: (setup: PageSetup) => string;
}

function keysField(
  id: PageFieldId,
  label: string,
  keys: readonly ("width" | "height" | "orientation" | "spatiumMm" | "pageTurns")[],
  format: (setup: PageSetup) => string,
): PageFieldDefinition {
  return {
    id,
    label,
    pick: (layer) => Object.fromEntries(keys.filter((key) => layer[key] !== undefined).map((key) => [key, layer[key]])),
    omit: (layer) => {
      const next = { ...layer };
      for (const key of keys) delete next[key];
      return next;
    },
    format,
  };
}

function marginField(id: PageFieldId, label: string, side: Side): PageFieldDefinition {
  return {
    id,
    label,
    pick: (layer) => (layer.margins?.[side] === undefined ? {} : { margins: { [side]: layer.margins[side] } }),
    omit: (layer) => {
      if (!layer.margins) return { ...layer };
      const margins = { ...layer.margins };
      delete margins[side];
      return { ...layer, margins };
    },
    format: (setup) => `${formatMm(setup.margins[side])} mm`,
  };
}

function formatStaffSize(setup: PageSetup): string {
  const rastral = RASTRAL_SPATIUM_MM.findIndex((spatium) => Math.abs(spatium - setup.spatiumMm) < 0.001);
  const staffHeight = formatMm(setup.spatiumMm * 4);
  return rastral >= 0 ? `Rastral ${rastral} (${staffHeight} mm)` : `${staffHeight} mm staff`;
}

function formatPageTurns(setup: PageSetup): string {
  if (!setup.pageTurns?.enabled) return "Off";
  return setup.pageTurns.preset === "professional" ? "Professional" : "Relaxed";
}

export const PAGE_FIELDS: readonly PageFieldDefinition[] = [
  keysField("pageSize", "Page size", ["width", "height", "orientation"], (setup) => {
    const name = findPageSizeName(setup.width, setup.height);
    const size = name === "Custom" ? `${formatMm(setup.width)} × ${formatMm(setup.height)} mm` : name;
    return `${size} ${setup.orientation}`;
  }),
  keysField("staffSize", "Staff size", ["spatiumMm"], formatStaffSize),
  marginField("marginTop", "Top margin", "top"),
  marginField("marginBottom", "Bottom margin", "bottom"),
  marginField("marginLeft", "Left margin", "left"),
  marginField("marginRight", "Right margin", "right"),
  keysField("pageTurns", "Page turns", ["pageTurns"], formatPageTurns),
];

function hasValues(layer: PageSetupOverride): boolean {
  return Object.values(layer).some((value) =>
    value && typeof value === "object" && !("enabled" in value)
      ? Object.values(value).some((entry) => entry !== undefined)
      : value !== undefined,
  );
}

function mergeLayers(base: PageSetupOverride | undefined, layer: PageSetupOverride): PageSetupOverride {
  return {
    ...base,
    ...layer,
    ...(base?.margins || layer.margins ? { margins: { ...base?.margins, ...layer.margins } } : {}),
  };
}

export function isFieldSet(score: Score, scope: PageScope, field: PageFieldDefinition): boolean {
  const layer = readPageLayer(score, scope);
  return layer ? hasValues(field.pick(layer)) : false;
}

/** Store explicit values for one field at a layer, keeping the rest of the layer intact. */
export function setPageValues(score: Score, scope: PageScope, values: PageSetupOverride): Score {
  return writePageLayer(score, scope, mergeLayers(readPageLayer(score, scope), values));
}

export function resetField(score: Score, scope: PageScope, field: PageFieldDefinition): Score {
  const layer = readPageLayer(score, scope);
  return layer ? writePageLayer(score, scope, field.omit(layer)) : score;
}

/** Move a layout's value up to the profile it inherits from, so sibling layouts pick it up too. */
export function promoteField(score: Score, scope: LayoutScope, field: PageFieldDefinition): Score {
  const layer = readPageLayer(score, scope);
  if (!layer) return score;
  const profile = layoutProfileScope(score, scope.index);
  return resetField(setPageValues(score, profile, field.pick(layer)), scope, field);
}

/** Layouts that inherit from a profile but set their own value for a field. */
export function downstreamOverrides(score: Score, profile: ProfileScope, field: PageFieldDefinition): number[] {
  return layoutsUsingProfile(score, profile).filter((index) => isFieldSet(score, { kind: "layout", index }, field));
}

export function clearDownstream(score: Score, profile: ProfileScope, field: PageFieldDefinition): Score {
  return downstreamOverrides(score, profile, field).reduce(
    (current, index) => resetField(current, { kind: "layout", index }, field),
    score,
  );
}

export function customPageFields(score: Score, scope: PageScope): PageFieldDefinition[] {
  return PAGE_FIELDS.filter((field) => isFieldSet(score, scope, field));
}

/** Copy the effective values of fields from one layer into other layouts as their own overrides. */
export function copyPageFields(
  score: Score,
  from: PageScope,
  targets: readonly number[],
  fields: readonly PageFieldDefinition[],
): Score {
  const source = resolvedPageSetup(score, from);
  return targets.reduce((current, index) => {
    const scope: LayoutScope = { kind: "layout", index };
    return fields.reduce((next, field) => {
      const values = field.pick(source);
      return hasValues(values) ? setPageValues(next, scope, values) : resetField(next, scope, field);
    }, current);
  }, score);
}
