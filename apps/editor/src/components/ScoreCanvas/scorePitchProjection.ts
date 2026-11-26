import { parseMnx, serializeMnx } from "@viritura/format";

export function scorePitchMnx(mnx: string, scoreIndex: number, useWritten: boolean): string {
  const score = parseMnx(JSON.parse(mnx));
  const definitions = score.scores?.length ? score.scores : [{}];
  if (!definitions[scoreIndex]) throw new RangeError(`Missing score ${scoreIndex + 1}`);
  return JSON.stringify(
    serializeMnx({
      ...score,
      scores: definitions.map((definition, index) =>
        index === scoreIndex ? { ...definition, useWritten } : definition,
      ),
    }),
  );
}
