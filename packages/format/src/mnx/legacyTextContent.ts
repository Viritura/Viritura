/**
 * Read-time upgrade of legacy text content.
 *
 * `text-content` was once `string | chunk[]`. The schema and model are now
 * array-only, so documents written before that change would fail validation.
 * This widens `"dolce"` to `[{ "text": "dolce" }]` at the three places the
 * schema references `text-content`, before the validator runs.
 *
 * Native MNX positioned text (`parts[].measures[].text[]`) uses MNX
 * `formatted-text` chunks, whose inline formatting lives in `_x.viritura`.
 * Earlier MusicXML conversions wrote Viritura's vendor run shape there instead
 * (`style`/`smuflStyle` on the chunk, glyph runs without `type: "smufl"`), so
 * those chunks are rewritten into the native shape.
 *
 * Documents that need no upgrade are returned untouched, so current files pay
 * only a shallow scan.
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
    for (const tempo of asArray(viritura?.["tempos"]) ?? []) {
      const owner = asObj(tempo);
      if (owner) visit(owner);
    }
  }
}

/** Visit every chunk of native MNX positioned text in part measures. */
function eachNativeTextChunk(doc: Obj, visit: (chunk: Obj) => void): void {
  for (const part of asArray(doc["parts"]) ?? []) {
    for (const measure of asArray(asObj(part)?.["measures"]) ?? []) {
      for (const item of asArray(asObj(measure)?.["text"]) ?? []) {
        for (const chunk of asArray(asObj(item)?.["text"]) ?? []) {
          const owner = asObj(chunk);
          if (owner) visit(owner);
        }
      }
    }
  }
}

const VENDOR_CHUNK_KEYS = ["style", "smuflStyle"] as const;

function isVendorShapedChunk(chunk: Obj): boolean {
  if (VENDOR_CHUNK_KEYS.some((key) => key in chunk)) return true;
  return Array.isArray(chunk["glyphs"]) && chunk["type"] === undefined;
}

function nativizeChunk(chunk: Obj): void {
  const moved: Obj = {};
  const hasStyle = VENDOR_CHUNK_KEYS.some((key) => key in chunk);
  const x = asObj(chunk["_x"]);
  const viritura = asObj(x?.["viritura"]);
  if (hasStyle) {
    if ("_x" in chunk && !x) return;
    if (x && "viritura" in x && !viritura) return;
    if (viritura && VENDOR_CHUNK_KEYS.some((key) => key in chunk && key in viritura)) return;
  }
  if (Array.isArray(chunk["glyphs"]) && chunk["type"] === undefined) chunk["type"] = "smufl";
  for (const key of VENDOR_CHUNK_KEYS) {
    if (!(key in chunk)) continue;
    moved[key] = chunk[key];
    delete chunk[key];
  }
  if (Object.keys(moved).length === 0) return;
  chunk["_x"] = { ...x, viritura: { ...viritura, ...moved } };
}

function needsUpgrade(doc: Obj): boolean {
  let found = false;
  eachTextOwner(doc, (owner) => {
    if (typeof owner["text"] === "string") found = true;
  });
  if (found) return true;
  eachNativeTextChunk(doc, (chunk) => {
    if (isVendorShapedChunk(chunk)) found = true;
  });
  return found;
}

/**
 * Widen legacy plain-string `text` values to single-run arrays and rewrite
 * vendor-shaped native text chunks. Returns the input unchanged when there is
 * nothing to upgrade.
 */
export function migrateLegacyTextContent(json: unknown): unknown {
  const doc = asObj(json);
  if (!doc || !needsUpgrade(doc)) return json;

  const upgraded = structuredClone(doc);
  eachTextOwner(upgraded, (owner) => {
    const text = owner["text"];
    if (typeof text === "string") {
      owner["text"] = [{ text }];
    }
  });
  eachNativeTextChunk(upgraded, nativizeChunk);
  return upgraded;
}
