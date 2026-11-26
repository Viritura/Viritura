type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

const REST_KEYS = new Set(["type", "id", "duration", "rest", "measure", "staff", "orient", "stemDirection"]);
const SEQUENCE_KEYS = new Set(["type", "id", "content", "staff", "voice", "orient", "fullMeasure"]);

function unmarkedContent(item: unknown): boolean {
  if (!isRecord(item)) return false;
  if (item["type"] === "space") return true;
  if (item["type"] !== undefined && item["type"] !== "event") return false;
  return Object.entries(item).every(([key, value]) => REST_KEYS.has(key) || isEmptyValue(value));
}

/**
 * Conservative mirror of the engine's empty-staff test: a part measure is
 * empty only when every sequence holds unmarked rests or spaces and the
 * measure carries no other notation. Unknown content counts as music, so an
 * imported staff is never mapped to automatic hiding on uncertain evidence.
 */
export function isUnmarkedMeasure(measure: unknown, index: number): boolean {
  if (!isRecord(measure)) return false;
  return Object.entries(measure).every(([key, value]) => {
    if (key === "id") return true;
    if (key === "clefs") return index === 0 || isEmptyValue(value);
    if (key !== "sequences") return isEmptyValue(value);
    return (
      Array.isArray(value) &&
      value.every(
        (sequence) =>
          isRecord(sequence) &&
          Object.entries(sequence).every(([field, content]) =>
            field === "content"
              ? Array.isArray(content) && content.every(unmarkedContent)
              : SEQUENCE_KEYS.has(field) || isEmptyValue(content),
          ),
      )
    );
  });
}

function containsNotes(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((item) => {
    if (!isRecord(item)) return false;
    if (Array.isArray(item["notes"]) && item["notes"].length > 0) return true;
    if (Array.isArray(item["kitNotes"]) && item["kitNotes"].length > 0) return true;
    return containsNotes(item["content"]);
  });
}

/** True when the measure certainly sounds, so the engine never treats it as empty. */
export function measureHasNotes(measure: unknown): boolean {
  if (!isRecord(measure) || !Array.isArray(measure["sequences"])) return false;
  return measure["sequences"].some((sequence) => isRecord(sequence) && containsNotes(sequence["content"]));
}
