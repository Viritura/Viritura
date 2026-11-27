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
import { applyDenigmaGapReport } from "./gapAdapters";
import { adaptHiddenStaves } from "./hiddenStaves";
import { createModuleCache } from "./moduleCache";

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
    pitchDisplayMode: number,
    selectedOutputs: number,
    selectedOutputCount: number,
    writeGapReport: number,
    validate: number,
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
const DENIGMA_FORMAT_ENIGMAXML = 2;

export class DenigmaConversionError extends Error {
  constructor(
    message: string,
    readonly diagnostics: DenigmaDiagnostic[],
  ) {
    super(message);
    this.name = "DenigmaConversionError";
  }
}

const moduleCache = createModuleCache(async (): Promise<DenigmaModule> => {
  const moduleUrl = new URL("/denigma/denigma.js", self.location.origin).href;
  const wasmUrl = new URL("/denigma/denigma.wasm", self.location.origin).href;
  const imported = (await import(/* @vite-ignore */ moduleUrl)) as { default: DenigmaModuleFactory };
  return imported.default({
    locateFile: (path) => (path.endsWith(".wasm") ? wasmUrl : path),
    print: () => undefined,
    printErr: () => undefined,
  });
});

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

function isPageTextGap(value: Record<string, unknown>): boolean {
  const pageText = value.pageText;
  return (
    value.anchor === undefined &&
    isRecord(pageText) &&
    Array.isArray(pageText.placements) &&
    pageText.placements.every(
      (placement) => isRecord(placement) && placement.kind === "page" && typeof placement.anchor === "string",
    )
  );
}

function isExpressionPlacements(value: Record<string, unknown>): boolean {
  const expression = value.expression;
  if (value.type !== "expression" || !isRecord(expression) || expression.placements === undefined) return true;
  if (!Array.isArray(expression.placements)) return false;
  return expression.placements.every(
    (placement) =>
      isGapAnchor(placement) &&
      isRecord(placement) &&
      (placement.kind === "staff" || placement.kind === "system-top" || placement.kind === "system-bottom") &&
      (placement.placement === undefined ||
        placement.placement === "above" ||
        placement.placement === "below" ||
        placement.placement === "float"),
  );
}

function isSmartShapeEnd(value: Record<string, unknown>): boolean {
  const smartShape = value.smartShape;
  return (
    value.type !== "smart-shape" || !isRecord(smartShape) || smartShape.end === undefined || isGapAnchor(smartShape.end)
  );
}

function isTextRanges(value: Record<string, unknown>): boolean {
  if (value.type !== "text-formatting" && value.type !== "text-insert") return true;
  const payload = value[value.type === "text-formatting" ? "formatting" : "insert"];
  return (
    isRecord(payload) &&
    Array.isArray(payload.ranges) &&
    payload.ranges.every(
      (range) =>
        isRecord(range) &&
        typeof range.anchor === "string" &&
        typeof range.offset === "number" &&
        Number.isSafeInteger(range.offset) &&
        range.offset >= 0 &&
        typeof range.length === "number" &&
        Number.isSafeInteger(range.length) &&
        range.length > 0,
    )
  );
}

function isGap(value: unknown): value is DenigmaGap {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    (value.extent !== "complete" && value.extent !== "partial")
  ) {
    return false;
  }
  if (value.type === "page-text") return isPageTextGap(value);
  return (
    typeof value.anchor === "string" &&
    isGapAnchor(value) &&
    isExpressionPlacements(value) &&
    isSmartShapeEnd(value) &&
    isTextRanges(value)
  );
}

function hasKnownFontReferences(value: unknown, fonts: Record<string, unknown>): boolean {
  if (Array.isArray(value)) return value.every((item) => hasKnownFontReferences(item, fonts));
  if (!isRecord(value)) return true;
  return Object.entries(value).every(([key, child]) => {
    if (key === "font") return typeof child === "string" && isRecord(fonts[child]);
    return hasKnownFontReferences(child, fonts);
  });
}

function isGapReport(value: unknown): value is DenigmaGapReport {
  const fonts =
    isRecord(value) && value.fonts === undefined
      ? {}
      : isRecord(value) && isRecord(value.fonts)
        ? value.fonts
        : undefined;
  return (
    isRecord(value) &&
    value.schemaVersion === 3 &&
    isRecord(value.producer) &&
    typeof value.producer.name === "string" &&
    typeof value.producer.version === "string" &&
    typeof value.producer.commit === "string" &&
    Array.isArray(value.gaps) &&
    value.gaps.every(isGap) &&
    fonts !== undefined &&
    Object.values(fonts).every(isRecord) &&
    hasKnownFontReferences(value.gaps, fonts) &&
    (value.leadingBlankPageSlots === undefined ||
      (typeof value.leadingBlankPageSlots === "number" &&
        Number.isSafeInteger(value.leadingBlankPageSlots) &&
        value.leadingBlankPageSlots >= 0)) &&
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

const HIDE_MODES_UNAVAILABLE: DenigmaDiagnostic = {
  severity: "info",
  message: "Finale staff hide modes could not be inspected; cutaway staves are not reported.",
};

/**
 * Decoded Finale document for checks the MNX output cannot express. Denigma
 * caches the extracted archive, so this costs no second decode.
 */
function readEnigmaXml(
  module: DenigmaModule,
  inputPointer: number,
  inputSize: number,
  namePointer: number,
): { xml?: string; diagnostic?: DenigmaDiagnostic } {
  const resultPointer = module._denigma_convert(
    inputPointer,
    inputSize,
    namePointer,
    DENIGMA_FORMAT_ENIGMAXML,
    0,
    0,
    0,
    0,
    -1,
    0,
    0,
    0,
    0,
    0,
    0,
  );
  try {
    const size =
      resultPointer && module._denigma_result_output_count(resultPointer) === 1
        ? module._denigma_result_output_size(resultPointer, 0)
        : 0;
    if (!resultPointer || module._denigma_result_success(resultPointer) !== 1 || size === 0) {
      return { diagnostic: HIDE_MODES_UNAVAILABLE };
    }
    const pointer = module._denigma_result_output_data(resultPointer, 0);
    return { xml: new TextDecoder().decode(module.HEAPU8.slice(pointer, pointer + size)) };
  } finally {
    if (resultPointer) module._denigma_result_destroy(resultPointer);
  }
}

export async function convertWithDenigma(
  source: ArrayBuffer,
  sourceName: string,
  options: MusxImportOptions,
): Promise<MusxImportResult> {
  await validateMusxArchive(new Uint8Array(source));
  const module = await moduleCache.get();
  const input = new Uint8Array(source);
  let inputPointer = 0;
  let namePointer = 0;
  let resultPointer = 0;
  let failed = false;

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
      0, // pitchDisplayMode: source display (ignored for MNX)
      0,
      0,
      1,
      0, // validate: Viritura validates the MNX it imports itself
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
    const gapReport = readGapReport(module, resultPointer);
    const adaptation = applyDenigmaGapReport(new TextDecoder().decode(output), gapReport, options.indentSpaces);
    let enigma: ReturnType<typeof readEnigmaXml>;
    try {
      enigma = readEnigmaXml(module, inputPointer, input.byteLength, namePointer);
    } catch {
      // The MNX is already decoded; only the hide-mode inspection is lost, but the instance is suspect.
      failed = true;
      moduleCache.discard();
      enigma = { diagnostic: HIDE_MODES_UNAVAILABLE };
    }
    const hiddenStaves = adaptHiddenStaves(adaptation.mnxJson, enigma.xml, options.indentSpaces);
    return {
      mnxJson: hiddenStaves.mnxJson,
      gapReport,
      gapOutcomes: adaptation.outcomes,
      diagnostics: [
        ...diagnostics,
        ...adaptation.diagnostics,
        ...hiddenStaves.diagnostics,
        ...(enigma.diagnostic ? [enigma.diagnostic] : []),
      ],
      denigmaVersion: module.UTF8ToString(module._denigma_version()),
      denigmaCommit: module.UTF8ToString(module._denigma_commit()),
    };
  } catch (error) {
    // The failure may have left the instance unusable, so the next conversion loads a fresh one.
    failed = true;
    moduleCache.discard();
    throw error;
  } finally {
    const release = () => {
      if (resultPointer) module._denigma_result_destroy(resultPointer);
      if (inputPointer) module._denigma_free(inputPointer);
      if (namePointer) module._denigma_free(namePointer);
    };
    if (failed) {
      try {
        release();
      } catch {
        // An aborted instance may reject these calls; it has been discarded, and the original error is rethrown.
      }
    } else {
      release();
    }
  }
}
