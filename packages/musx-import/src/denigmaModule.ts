import type {
  DenigmaDiagnostic,
  DenigmaDiagnosticSeverity,
  DenigmaGap,
  DenigmaGapAnchor,
  DenigmaGapReport,
  MusxImportOptions,
  MusxImportResult,
} from "./types";
import { validateMusxArchive } from "./archiveLimits";

interface DenigmaModule {
  HEAPU8: Uint8Array;
  UTF8ToString(pointer: number): string;
  _denigma_malloc(size: number): number;
  _denigma_free(pointer: number): void;
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
    selectedOutputs: number,
    selectedOutputCount: number,
  ): number;
  _denigma_result_destroy(result: number): void;
  _denigma_result_success(result: number): number;
  _denigma_result_diagnostic_count(result: number): number;
  _denigma_result_diagnostic_severity(result: number, index: number): number;
  _denigma_result_diagnostic_message(result: number, index: number): number;
  _denigma_result_output_count(result: number): number;
  _denigma_result_output_data(result: number, index: number): number;
  _denigma_result_output_size(result: number, index: number): number;
  _denigma_result_gap_report_data(result: number): number;
  _denigma_result_gap_report_size(result: number): number;
  _denigma_version(): number;
  _denigma_commit(): number;
}

interface DenigmaModuleFactoryOptions {
  locateFile(path: string): string;
  print(message: string): void;
  printErr(message: string): void;
}

type DenigmaModuleFactory = (options: DenigmaModuleFactoryOptions) => Promise<DenigmaModule>;

const severityNames: readonly DenigmaDiagnosticSeverity[] = ["info", "warning", "error", "verbose"];
const DENIGMA_FORMAT_MNX = 1;

let modulePromise: Promise<DenigmaModule> | undefined;

export class DenigmaConversionError extends Error {
  constructor(
    message: string,
    readonly diagnostics: DenigmaDiagnostic[],
  ) {
    super(message);
    this.name = "DenigmaConversionError";
  }
}

async function loadDenigmaModule(): Promise<DenigmaModule> {
  modulePromise ??= (async () => {
    const moduleUrl = new URL("/denigma/denigma.js", self.location.origin).href;
    const wasmUrl = new URL("/denigma/denigma.wasm", self.location.origin).href;
    const imported = (await import(/* @vite-ignore */ moduleUrl)) as { default: DenigmaModuleFactory };
    return imported.default({
      locateFile: (path) => (path.endsWith(".wasm") ? wasmUrl : path),
      print: () => undefined,
      printErr: () => undefined,
    });
  })();
  return modulePromise;
}

function allocateBytes(module: DenigmaModule, bytes: Uint8Array): number {
  const pointer = module._denigma_malloc(bytes.byteLength);
  if (!pointer && bytes.byteLength > 0) throw new Error("Unable to allocate memory for the MUSX file.");
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

function allocateString(module: DenigmaModule, value: string): number {
  const encoded = new TextEncoder().encode(`${value}\0`);
  const pointer = module._denigma_malloc(encoded.byteLength);
  if (!pointer) throw new Error("Unable to allocate the MUSX filename.");
  module.HEAPU8.set(encoded, pointer);
  return pointer;
}

function readDiagnostics(module: DenigmaModule, resultPointer: number): DenigmaDiagnostic[] {
  const diagnostics: DenigmaDiagnostic[] = [];
  const count = module._denigma_result_diagnostic_count(resultPointer);
  for (let index = 0; index < count; index += 1) {
    diagnostics.push({
      severity: severityNames[module._denigma_result_diagnostic_severity(resultPointer, index)] ?? "error",
      message: module.UTF8ToString(module._denigma_result_diagnostic_message(resultPointer, index)),
    });
  }
  return diagnostics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGapAnchor(value: unknown): value is DenigmaGapAnchor {
  if (!isRecord(value) || typeof value.anchor !== "string") return false;
  if (
    value.staff !== undefined &&
    (typeof value.staff !== "number" || !Number.isInteger(value.staff) || value.staff < 1)
  ) {
    return false;
  }
  if (value.position === undefined) return true;
  return (
    isRecord(value.position) &&
    typeof value.position.numerator === "number" &&
    Number.isInteger(value.position.numerator) &&
    typeof value.position.denominator === "number" &&
    Number.isInteger(value.position.denominator) &&
    value.position.denominator !== 0
  );
}

function isGap(value: unknown): value is DenigmaGap {
  if (!isGapAnchor(value) || !isRecord(value)) return false;
  if (typeof value.type !== "string" || (value.extent !== "complete" && value.extent !== "partial")) return false;
  if (value.end !== undefined && !isGapAnchor(value.end)) return false;
  if (value.placements === undefined) return true;
  return (
    Array.isArray(value.placements) &&
    value.placements.every(
      (placement) =>
        isGapAnchor(placement) &&
        isRecord(placement) &&
        (placement.kind === "staff" || placement.kind === "system-top" || placement.kind === "system-bottom"),
    )
  );
}

function isGapReport(value: unknown): value is DenigmaGapReport {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    isRecord(value.producer) &&
    typeof value.producer.name === "string" &&
    typeof value.producer.version === "string" &&
    typeof value.producer.commit === "string" &&
    Array.isArray(value.gaps) &&
    value.gaps.every(isGap) &&
    (value.arrowheads === undefined || isRecord(value.arrowheads))
  );
}

function readGapReport(module: DenigmaModule, resultPointer: number): DenigmaGapReport {
  const pointer = module._denigma_result_gap_report_data(resultPointer);
  const size = module._denigma_result_gap_report_size(resultPointer);
  if (!pointer || size === 0) {
    throw new Error("Denigma did not return an MNX conversion gap report.");
  }

  const json = new TextDecoder().decode(module.HEAPU8.slice(pointer, pointer + size));
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Denigma returned an invalid gap report: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isGapReport(parsed)) {
    throw new Error("Denigma returned an unsupported or malformed gap report.");
  }
  return parsed;
}

export async function convertWithDenigma(
  source: ArrayBuffer,
  sourceName: string,
  options: MusxImportOptions,
): Promise<MusxImportResult> {
  await validateMusxArchive(new Uint8Array(source));
  const module = await loadDenigmaModule();
  const input = new Uint8Array(source);
  let inputPointer = 0;
  let namePointer = 0;
  let resultPointer = 0;

  try {
    inputPointer = allocateBytes(module, input);
    namePointer = allocateString(module, sourceName);
    resultPointer = module._denigma_convert(
      inputPointer,
      input.byteLength,
      namePointer,
      DENIGMA_FORMAT_MNX,
      options.includeTempoTool ? 1 : 0,
      0,
      0,
      options.splitInstruments ? 1 : 0,
      options.indentSpaces ?? -1,
      options.cueLayer ?? 0,
      0,
      0,
    );
    if (!resultPointer) throw new Error("Denigma did not return a conversion result.");

    const diagnostics = readDiagnostics(module, resultPointer);
    const outputCount = module._denigma_result_output_count(resultPointer);
    const outputSize = outputCount === 1 ? module._denigma_result_output_size(resultPointer, 0) : 0;
    if (module._denigma_result_success(resultPointer) !== 1 || outputCount !== 1 || outputSize === 0) {
      const detail = diagnostics.find((diagnostic) => diagnostic.severity === "error")?.message;
      throw new DenigmaConversionError(detail ?? "Denigma could not convert the MUSX file.", diagnostics);
    }

    const outputPointer = module._denigma_result_output_data(resultPointer, 0);
    const output = module.HEAPU8.slice(outputPointer, outputPointer + outputSize);
    return {
      mnxJson: new TextDecoder().decode(output),
      gapReport: readGapReport(module, resultPointer),
      diagnostics,
      denigmaVersion: module.UTF8ToString(module._denigma_version()),
      denigmaCommit: module.UTF8ToString(module._denigma_commit()),
    };
  } finally {
    if (resultPointer) module._denigma_result_destroy(resultPointer);
    if (inputPointer) module._denigma_free(inputPointer);
    if (namePointer) module._denigma_free(namePointer);
  }
}
