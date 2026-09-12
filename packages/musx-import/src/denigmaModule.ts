import type { DenigmaDiagnostic, DenigmaDiagnosticSeverity, MusxImportOptions, MusxImportResult } from "./types";
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
