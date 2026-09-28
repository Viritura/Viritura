/**
 * Read-time upgrade of legacy plain-string text content.
 *
 * `text-content` was once `string | chunk[]`. The schema and model are now
 * array-only, so documents written before that change would fail validation.
 * This widens `"dolce"` to `[{ "text": "dolce" }]` at the three places the
 * schema references `text-content`, before the validator runs.
 *
 * Documents that carry no legacy strings are returned untouched, so current
 * files pay only a shallow scan.
 */

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function virituraOf(owner: unknown): Obj | undefined {
  return asObj(asObj(asObj(owner)?.["_x"])?.["viritura"]);
}

/** Visit every object whose `text` property is a `text-content` value. */
function eachTextOwner(doc: Obj, visit: (owner: Obj) => void): void {
  for (const measure of asArray(asObj(doc["global"])?.["measures"]) ?? []) {
    const viritura = virituraOf(measure);
    const rehearsalMark = asObj(viritura?.["rehearsalMark"]);
    if (rehearsalMark) visit(rehearsalMark);
    for (const tempo of asArray(asObj(measure)?.["tempos"]) ?? []) {
      const tempoExt = virituraOf(tempo);
      if (tempoExt) visit(tempoExt);
    }
  }
  for (const part of asArray(doc["parts"]) ?? []) {
    for (const measure of asArray(asObj(part)?.["measures"]) ?? []) {
      for (const expression of asArray(virituraOf(measure)?.["expressions"]) ?? []) {
        const expr = asObj(expression);
        if (expr) visit(expr);
      }
    }
  }
}

function hasLegacyText(doc: Obj): boolean {
  let found = false;
  eachTextOwner(doc, (owner) => {
    if (typeof owner["text"] === "string") found = true;
  });
  return found;
}

/**
 * Widen legacy plain-string `text` values to single-run arrays. Returns the
 * input unchanged when there is nothing to upgrade.
 */
export function migrateLegacyTextContent(json: unknown): unknown {
  const doc = asObj(json);
  if (!doc || !hasLegacyText(doc)) return json;

  const upgraded = structuredClone(doc);
  eachTextOwner(upgraded, (owner) => {
    const text = owner["text"];
    if (typeof text === "string") {
      owner["text"] = [{ text }];
    }
  });
  return upgraded;
}
