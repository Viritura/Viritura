import { parseMnx, serializeMnx } from "@viritura/format";

export function sourcePartMnx(mnx: string, partIndex: number): string {
  const score = parseMnx(JSON.parse(mnx));
  const part = score.parts[partIndex];
  if (!part) throw new RangeError(`Missing part ${partIndex + 1}`);
  return JSON.stringify(
    serializeMnx({
      ...score,
      parts: [part],
      layouts: undefined,
      scores: [{ name: part.name, useWritten: true, pageSetupRole: "part" }],
    }),
  );
}
