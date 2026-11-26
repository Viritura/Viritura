type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

const REST_KEYS = new Set(["type", "id", "duration", "rest", "measure", "staff", "orient", "stemDirection"]);
const SEQUENCE_KEYS = new Set(["type", "id", "content", "staff", "voice", "orient"]);

function unmarkedSequenceField(field: string, value: unknown): boolean {
  if (field === "content") return Array.isArray(value) && value.every(unmarkedContent);
  if (field === "fullMeasure") return isRecord(value) && value["fermata"] === undefined;
  return SEQUENCE_KEYS.has(field) || isEmptyValue(value);
}

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
          Object.entries(sequence).every(([field, content]) => unmarkedSequenceField(field, content)),
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

function events(content: unknown, found: Json[] = []): Json[] {
  if (!Array.isArray(content)) return found;
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item["type"] === undefined || item["type"] === "event") found.push(item);
    events(item["content"], found);
  }
  return found;
}

function targets(spans: unknown): string[] {
  return Array.isArray(spans)
    ? spans.flatMap((span) => (isRecord(span) && typeof span["target"] === "string" ? [span["target"]] : []))
    : [];
}

/**
 * Measures a marking reaches after the one it starts in: hairpin, pedal and
 * ottava ends, slur and glissando targets, and measure repeats. The engine
 * keeps a staff visible across these spans even where its measures are rests.
 */
export function spannedMeasures(
  partMeasures: readonly unknown[],
  measureIndex: ReadonlyMap<string, number>,
): Set<number> {
  const measureEvents = partMeasures.map((measure) =>
    isRecord(measure) && Array.isArray(measure["sequences"])
      ? measure["sequences"].flatMap((sequence) => (isRecord(sequence) ? events(sequence["content"]) : []))
      : [],
  );
  const eventMeasure = new Map<string, number>();
  measureEvents.forEach((list, index) => {
    for (const event of list) if (typeof event["id"] === "string") eventMeasure.set(event["id"], index);
  });
  const spanned = new Set<number>();
  const cover = (start: number, end: number | undefined) => {
    const last = end ?? partMeasures.length - 1;
    for (let index = start + 1; index <= last; index += 1) spanned.add(index);
  };
  partMeasures.forEach((measure, start) => {
    if (!isRecord(measure)) return;
    for (const key of ["dynamics", "pedals", "ottavas"]) {
      for (const span of Array.isArray(measure[key]) ? measure[key] : []) {
        const end = isRecord(span) && isRecord(span["end"]) ? span["end"]["measure"] : undefined;
        if (typeof end === "string") cover(start, measureIndex.get(end));
        else if (key !== "dynamics") cover(start, undefined);
      }
    }
    for (const event of measureEvents[start]!) {
      for (const target of [...targets(event["slurs"]), ...targets(event["glissandos"])]) {
        cover(start, eventMeasure.get(target));
      }
    }
    const repeat = measure["measureRepeat"];
    if (isRecord(repeat) && typeof repeat["number"] === "number") cover(start, start + repeat["number"] - 1);
  });
  return spanned;
}
