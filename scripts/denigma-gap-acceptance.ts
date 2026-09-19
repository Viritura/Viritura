import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateRawScore } from "../packages/format/src/index";
import { applyDenigmaGapReport, type DenigmaGap, type DenigmaGapReport } from "../packages/musx-import/src/index";

interface DenigmaModule {
  HEAPU8: Uint8Array;
  UTF8ToString(pointer: number): string;
  _denigma_malloc(size: number): number;
  _denigma_free(pointer: number): void;
  _denigma_commit(): number;
  _denigma_convert(
    data: number,
    size: number,
    sourceName: number,
    format: number,
    includeTempo: number,
    allFontsAvailable: number,
    useFinaleRestPosition: number,
    splitInstruments: number,
    indentSpaces: number,
    cueLayer: number,
    enforceFinaleFontMetrics: number,
    transposeFinalePercussion: number,
  ): number;
  _denigma_result_success(result: number): number;
  _denigma_result_output_count(result: number): number;
  _denigma_result_output_data(result: number, index: number): number;
  _denigma_result_output_size(result: number, index: number): number;
  _denigma_result_gap_report_data(result: number): number;
  _denigma_result_gap_report_size(result: number): number;
  _denigma_result_diagnostic_count(result: number): number;
  _denigma_result_diagnostic_message(result: number, index: number): number;
  _denigma_result_destroy(result: number): void;
}

interface GapExpectation {
  type: string;
  subtype: string;
}

interface AcceptanceCase {
  file: string;
  gaps: GapExpectation[];
}

const [, , modulePath, fixtureRoot, expectedCommit] = process.argv;
if (!modulePath || !fixtureRoot || !expectedCommit) {
  throw new Error("usage: tsx denigma-gap-acceptance.ts <denigma.js> <fixture-directory> <expected-commit>");
}

const loadedModule = (await import(pathToFileURL(resolve(modulePath)).href)) as {
  default: () => Promise<DenigmaModule>;
};
const module = await loadedModule.default();
const DENIGMA_FORMAT_MNX = 1;
const actualCommit = module.UTF8ToString(module._denigma_commit()).replace(/-dirty$/, "");
if (!expectedCommit.startsWith(actualCommit)) {
  throw new Error(`Denigma module reports commit ${actualCommit}, expected ${expectedCommit}.`);
}

const CASES: AcceptanceCase[] = [
  { file: "slurs_2staves.musx", gaps: [] },
  { file: "techniques.musx", gaps: [{ type: "expression", subtype: "technique-text" }] },
  { file: "rehearsal_marks.musx", gaps: [{ type: "expression", subtype: "rehearsal-mark" }] },
  { file: "tempo_varied_staves.musx", gaps: [{ type: "expression", subtype: "tempo-alteration" }] },
  { file: "glissando.musx", gaps: [{ type: "smart-shape", subtype: "glissando" }] },
  {
    file: "smartshape_lines.musx",
    gaps: [
      { type: "expression", subtype: "generic-text" },
      { type: "smart-shape", subtype: "trill" },
      { type: "smart-shape", subtype: "trill-extension" },
    ],
  },
];

function gapSubtype(gap: DenigmaGap): string | undefined {
  const payload = gap.type === "expression" ? gap["expression"] : gap["smartShape"];
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const key = gap.type === "expression" ? "type" : "shapeType";
  return typeof payload[key] === "string" ? payload[key] : undefined;
}

function readUtf8(pointer: number, size: number): string {
  return new TextDecoder().decode(module.HEAPU8.slice(pointer, pointer + size));
}

function assertAdaptedOutput(testCase: AcceptanceCase, output: string, gapReport: DenigmaGapReport): void {
  const adaptation = applyDenigmaGapReport(output, gapReport);
  const parsed = JSON.parse(adaptation.mnxJson) as unknown;
  const validation = validateRawScore(parsed);
  if (!validation.ok) {
    const first = validation.errors[0];
    throw new Error(
      `${testCase.file} produced invalid adapted MNX: ${first?.pointer || "/"} ${first?.message || "unknown error"}`,
    );
  }
  if (adaptation.outcomes.length !== gapReport.gaps.length) {
    throw new Error(`${testCase.file} did not produce one adapter outcome per gap.`);
  }
  for (const expected of testCase.gaps) {
    const matching = adaptation.outcomes.filter(
      (entry) => entry.type === expected.type && entry.subtype === expected.subtype,
    );
    if (matching.length === 0) {
      throw new Error(`${testCase.file} did not report the expected ${expected.type}/${expected.subtype} gap.`);
    }
    if (matching.every((entry) => entry.disposition === "unhandled")) {
      throw new Error(`${testCase.file} left every ${expected.type}/${expected.subtype} gap unhandled.`);
    }
  }
}

async function convertFixture(testCase: AcceptanceCase): Promise<void> {
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
      const diagnostics = Array.from({ length: module._denigma_result_diagnostic_count(result) }, (_, index) =>
        module.UTF8ToString(module._denigma_result_diagnostic_message(result, index)),
      );
      if (module._denigma_result_success(result) !== 1) {
        throw new Error(diagnostics.join("\n") || `Denigma conversion failed for ${testCase.file}.`);
      }
      const outputCount = module._denigma_result_output_count(result);
      if (outputCount !== 1) {
        throw new Error(`Denigma produced ${outputCount} outputs for ${testCase.file}; expected one MNX document.`);
      }
      const outputSize = module._denigma_result_output_size(result, 0);
      const output = readUtf8(module._denigma_result_output_data(result, 0), outputSize);
      if (output.includes("-dirty")) {
        throw new Error(`Denigma output for ${testCase.file} reports a dirty source checkout.`);
      }
      const gapPointer = module._denigma_result_gap_report_data(result);
      const gapSize = module._denigma_result_gap_report_size(result);
      if (!gapPointer || !gapSize) {
        throw new Error(`Denigma returned no MNX conversion gap report for ${testCase.file}.`);
      }
      const gapReport = JSON.parse(readUtf8(gapPointer, gapSize)) as DenigmaGapReport;
      if (gapReport.schemaVersion !== 1 || !Array.isArray(gapReport.gaps)) {
        throw new Error(`Denigma returned an invalid MNX conversion gap report for ${testCase.file}.`);
      }
      for (const expected of testCase.gaps) {
        const found = gapReport.gaps.some((gap) => gap.type === expected.type && gapSubtype(gap) === expected.subtype);
        if (!found) {
          throw new Error(`${testCase.file} did not report the expected ${expected.type}/${expected.subtype} gap.`);
        }
      }
      assertAdaptedOutput(testCase, output, gapReport);
      console.log(
        `Converted and adapted ${testCase.file} (${input.byteLength} bytes) to ${outputSize} MNX bytes with ${gapReport.gaps.length} gaps.`,
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
