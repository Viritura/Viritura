import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , modulePath, fixtureRoot, expectedCommit] = process.argv;
if (!modulePath || !fixtureRoot || !expectedCommit) {
  throw new Error("usage: node smoke.mjs <denigma.js> <fixture-directory> <expected-commit>");
}

const createModule = (await import(pathToFileURL(resolve(modulePath)).href)).default;
const module = await createModule();
const DENIGMA_FORMAT_MNX = 1;
const actualCommit = module.UTF8ToString(module._denigma_commit()).replace(/-dirty$/, "");
if (!expectedCommit.startsWith(actualCommit)) {
  throw new Error(`Denigma module reports commit ${actualCommit}, expected ${expectedCommit}.`);
}
const CASES = [
  { file: "slurs_2staves.musx", gaps: [] },
  { file: "techniques.musx", gaps: [["expression", "technique-text"]] },
  { file: "rehearsal_marks.musx", gaps: [["expression", "rehearsal-mark"]] },
  { file: "tempo_varied_staves.musx", gaps: [["expression", "tempo-alteration"]] },
  { file: "glissando.musx", gaps: [["smart-shape", "glissando"]] },
  {
    file: "smartshape_lines.musx",
    gaps: [
      ["expression", "generic-text"],
      ["smart-shape", "trill"],
      ["smart-shape", "trill-extension"],
    ],
  },
];

function gapSubtype(gap) {
  if (gap.type === "expression") return gap.expression?.type;
  if (gap.type === "smart-shape") return gap.smartShape?.shapeType;
  return undefined;
}

async function convertFixture(testCase) {
  const input = await readFile(resolve(fixtureRoot, testCase.file));
  const inputPointer = module._denigma_malloc(input.byteLength);
  const name = new TextEncoder().encode(`${testCase.file}\0`);
  const namePointer = module._denigma_malloc(name.byteLength);

  try {
    module.HEAPU8.set(input, inputPointer);
    module.HEAPU8.set(name, namePointer);
    const result = module._denigma_convert(
      inputPointer,
      input.byteLength,
      namePointer,
      DENIGMA_FORMAT_MNX,
      1,
      0,
      0,
      0,
      -1,
      0,
      0,
      0,
    );
    if (!result) throw new Error(`Denigma returned no result for ${testCase.file}.`);
    try {
      const diagnostics = [];
      const diagnosticCount = module._denigma_result_diagnostic_count(result);
      for (let index = 0; index < diagnosticCount; index += 1) {
        diagnostics.push(module.UTF8ToString(module._denigma_result_diagnostic_message(result, index)));
      }
      if (module._denigma_result_success(result) !== 1) {
        throw new Error(diagnostics.join("\n") || `Denigma conversion failed for ${testCase.file}.`);
      }
      const outputCount = module._denigma_result_output_count(result);
      if (outputCount !== 1) {
        throw new Error(`Denigma produced ${outputCount} outputs for ${testCase.file}; expected one MNX document.`);
      }
      const outputPointer = module._denigma_result_output_data(result, 0);
      const outputSize = module._denigma_result_output_size(result, 0);
      const output = new TextDecoder().decode(module.HEAPU8.slice(outputPointer, outputPointer + outputSize));
      const parsed = JSON.parse(output);
      if (!parsed.global || !Array.isArray(parsed.parts)) {
        throw new Error(`Denigma output for ${testCase.file} is not an MNX document.`);
      }
      if (JSON.stringify(parsed).includes("-dirty")) {
        throw new Error(`Denigma output for ${testCase.file} reports a dirty source checkout.`);
      }
      const gapPointer = module._denigma_result_gap_report_data(result);
      const gapSize = module._denigma_result_gap_report_size(result);
      if (!gapPointer || !gapSize) {
        throw new Error(`Denigma returned no MNX conversion gap report for ${testCase.file}.`);
      }
      const gapReport = JSON.parse(new TextDecoder().decode(module.HEAPU8.slice(gapPointer, gapPointer + gapSize)));
      if (gapReport.schemaVersion !== 1 || !Array.isArray(gapReport.gaps)) {
        throw new Error(`Denigma returned an invalid MNX conversion gap report for ${testCase.file}.`);
      }
      for (const [type, subtype] of testCase.gaps) {
        const found = gapReport.gaps.some((gap) => gap.type === type && gapSubtype(gap) === subtype);
        if (!found) throw new Error(`${testCase.file} did not report the expected ${type}/${subtype} gap.`);
      }
      console.log(
        `Converted ${testCase.file} (${input.byteLength} bytes) to ${outputSize} MNX bytes with ${gapReport.gaps.length} gaps.`,
      );
    } finally {
      module._denigma_result_destroy(result);
    }
  } finally {
    module._denigma_free(inputPointer);
    module._denigma_free(namePointer);
  }
}

for (const testCase of CASES) {
  await convertFixture(testCase);
}
