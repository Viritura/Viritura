import { canonicalGlobalFermatas, fermataPositionKey, type GlobalFermata } from "@viritura/core";

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isGlobalFermata(value: unknown): value is GlobalFermata {
  const entry = object(value);
  const fraction = object(entry?.["position"])?.["fraction"];
  return (
    typeof entry?.["id"] === "string" &&
    Array.isArray(fraction) &&
    fraction.length === 2 &&
    fraction.every((item) => typeof item === "number") &&
    (entry["multiplier"] === undefined || typeof entry["multiplier"] === "number") &&
    (entry["clickBehavior"] === undefined ||
      entry["clickBehavior"] === "silent" ||
      entry["clickBehavior"] === "keepClicking")
  );
}

/** Canonical read projection converges without issuing normalization writes. */
export function canonicalizeFermataJson(root: Record<string, unknown>): void {
  const measures = object(root["global"])?.["measures"];
  if (!Array.isArray(measures)) return;
  measures.forEach((measure, measureIndex) => {
    const extension = object(object(object(measure)?.["_x"])?.["viritura"]);
    const fermatas = extension?.["fermatas"];
    if (fermatas === undefined) return;
    if (!Array.isArray(fermatas) || !fermatas.every(isGlobalFermata))
      throw new Error("Invalid global fermatas in CRDT score.");
    const canonical = canonicalGlobalFermatas(fermatas);
    extension!["fermatas"] = canonical;
    const winners = new Map(canonical.map((fermata) => [fermataPositionKey(fermata.position), fermata.id]));
    const aliases = new Map(
      fermatas.map((fermata) => [fermata.id, winners.get(fermataPositionKey(fermata.position))!]),
    );
    const parts = root["parts"];
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const partMeasures = object(part)?.["measures"];
        if (Array.isArray(partMeasures)) rewriteProjectionIds(partMeasures[measureIndex], aliases);
      }
    }
  });
}

function rewriteProjectionIds(value: unknown, aliases: ReadonlyMap<string, string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => rewriteProjectionIds(item, aliases));
    return;
  }
  const entry = object(value);
  if (!entry) return;
  const extension = object(object(entry["_x"])?.["viritura"]);
  const id = extension?.["globalFermataId"];
  if (typeof id === "string" && aliases.has(id)) extension!["globalFermataId"] = aliases.get(id);
  for (const [key, child] of Object.entries(entry)) {
    if (key !== "_x") rewriteProjectionIds(child, aliases);
  }
}
