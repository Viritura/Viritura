/**
 * Convert a MusicXML/MXL file to MNX and write it into the scores folder,
 * mirroring the editor's import path exactly:
 *
 *   convert(MXL) → MnxDocument → parseMnx → Score → serializeMnx → on-disk MNX
 *
 * The serialized form is precisely the JSON the editor hands to the WASM
 * engine, so validating that artifact (e.g. `cargo run --example load_mnx`)
 * tests the same bytes Viritura loads at runtime.
 *
 * Usage:
 *   pnpm tsx scripts/convert-score.ts "<input.mxl>" "<output.mnx>"
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { convertMxlToMnx, convertMusicXmlToMnx } from "@viritura/musicxml";
import { parseMnx, serializeMnx } from "@viritura/format";

async function main(): Promise<void> {
  const [, , inputArg, outputArg] = process.argv;
  if (!inputArg || !outputArg) {
    console.error('usage: convert-score.ts "<input.(mxl|musicxml|xml)>" "<output.mnx>"');
    process.exit(1);
  }

  const inputPath = resolve(inputArg);
  const outputPath = resolve(outputArg);
  const lower = inputPath.toLowerCase();

  // Mirror convertImportedFile: .mxl is binary (unzipped by the converter),
  // plain .musicxml/.xml is text. Preserve Viritura extensions (tempo text,
  // hairpins, pedals, rehearsal marks) the editor renders natively.
  const opts = { includeVendorExtensions: true } as const;
  const doc = lower.endsWith(".mxl")
    ? await convertMxlToMnx((await readFile(inputPath)).buffer as ArrayBuffer, opts)
    : convertMusicXmlToMnx(await readFile(inputPath, "utf8"), opts);

  // Round-trip through @viritura/format so the on-disk artifact matches the
  // exact bytes the editor sends to the engine.
  const score = parseMnx(JSON.parse(JSON.stringify(doc)));
  const serialized = serializeMnx(score);

  await writeFile(outputPath, JSON.stringify(serialized, null, 2), "utf8");
  console.log(`wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
