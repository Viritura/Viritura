import type { RawScoreValidationError, RecoveredSequence } from "@viritura/format";

/** Repository issue form used for import reports. */
const IMPORT_ISSUE_URL = "https://github.com/Viritura/Viritura/issues/new";

/** GitHub rejects very long URLs, so only the start of the log is prefilled. */
/** Keeps prefilled issue links under common browser and server URL limits. */
const MAX_ISSUE_URL_LENGTH = 8000;
const TRUNCATION_NOTE = "\n…(truncated; attach the downloaded log for the full report)\n";

/** Everything needed to explain an import problem and reproduce it. */
export interface ImportErrorLog {
  /** Name of the opened score (e.g. `score.mnx`). */
  filename: string;
  /** `recovered`: the score opened with emptied sequences; `failed`: it did not open. */
  status: "recovered" | "failed";
  /** ISO timestamp of the import. */
  createdAt: string;
  /** Producer recorded in the MNX provenance block, when present. */
  producer?: string;
  /** Source file recorded in the MNX provenance block, when present. */
  sourceFilename?: string;
  recovered: readonly RecoveredSequence[];
  /** Validation errors that prevented the score from opening. */
  fatalErrors: readonly RawScoreValidationError[];
  /** Non-validation failure message (e.g. invalid JSON). */
  failureMessage?: string;
  /** Warnings reported by the source-format converter. */
  converterWarnings: readonly string[];
  userAgent?: string;
}

interface BuildImportErrorLogArgs {
  filename: string;
  mnxJson: string;
  recovered: readonly RecoveredSequence[];
  failure?: unknown;
  converterWarnings?: readonly string[];
  now?: Date;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function describeTool(name: string | undefined, value: unknown): string | undefined {
  const tool = asObject(value);
  const toolName = name ?? tool?.["name"];
  if (!tool || typeof toolName !== "string") return undefined;
  const version = typeof tool["version"] === "string" ? ` ${tool["version"]}` : "";
  const commit = typeof tool["commit"] === "string" ? ` (${tool["commit"]})` : "";
  return `${toolName}${version}${commit}`;
}

function readProvenance(mnxJson: string): Pick<ImportErrorLog, "producer" | "sourceFilename"> {
  let root: JsonObject | undefined;
  try {
    root = asObject(JSON.parse(mnxJson));
  } catch {
    return {};
  }
  const mnxdom = asObject(asObject(asObject(root?.["mnx"])?.["_x"])?.["mnxdom"]);
  if (!mnxdom) return {};
  const producer = [describeTool(undefined, mnxdom["client"]), describeTool("mnxdom", mnxdom["mnxdom"])]
    .filter(Boolean)
    .join("; ");
  const source = asObject(mnxdom["source"])?.["filename"];
  return {
    ...(producer ? { producer } : {}),
    ...(typeof source === "string" ? { sourceFilename: source } : {}),
  };
}

function isValidationFailure(error: unknown): error is Error & { errors: readonly RawScoreValidationError[] } {
  return error instanceof Error && Array.isArray((error as { errors?: unknown }).errors);
}

/** Collect the facts for an import error log from the opened file and its outcome. */
export function buildImportErrorLog({
  filename,
  mnxJson,
  recovered,
  failure,
  converterWarnings = [],
  now = new Date(),
}: BuildImportErrorLogArgs): ImportErrorLog {
  const log: ImportErrorLog = {
    filename,
    status: failure === undefined ? "recovered" : "failed",
    createdAt: now.toISOString(),
    ...readProvenance(mnxJson),
    recovered,
    fatalErrors: isValidationFailure(failure) ? failure.errors : [],
    converterWarnings,
  };
  if (failure !== undefined && !isValidationFailure(failure)) {
    log.failureMessage = failure instanceof Error ? failure.message : String(failure);
  }
  if (typeof navigator !== "undefined") log.userAgent = navigator.userAgent;
  return log;
}

function formatError(error: RawScoreValidationError): string {
  return `    - ${error.pointer || "/"} [${error.keyword}] ${error.message}`;
}

/** Human-readable location of an emptied sequence. */
function describeRecoveredSequence(entry: RecoveredSequence): string {
  const part = entry.partName ?? (entry.partId ? `Part ${entry.partId}` : `Part ${entry.partIndex + 1}`);
  const measure = `measure ${entry.measureIndex + 1}${entry.measureId ? ` (${entry.measureId})` : ""}`;
  const voice = entry.voice ? `, voice ${entry.voice}` : "";
  return `${part}, ${measure}, staff ${entry.staff}${voice}`;
}

/** One-line outcome shown in the dialog and at the top of the log. */
export function summarizeImportErrorLog(log: ImportErrorLog): string {
  if (log.status === "failed") return `${log.filename} could not be opened.`;
  const count = log.recovered.length;
  return `${log.filename} opened, but ${count} voice${count === 1 ? "" : "s"} could not be read and ${
    count === 1 ? "was" : "were"
  } left empty.`;
}

/** Plain-text log suitable for download and for attaching to an issue. */
export function formatImportErrorLog(log: ImportErrorLog): string {
  const lines = ["Viritura import error log", "", `File: ${log.filename}`];
  if (log.sourceFilename) lines.push(`Source file: ${log.sourceFilename}`);
  if (log.producer) lines.push(`Produced by: ${log.producer}`);
  lines.push(`Imported: ${log.createdAt}`);
  if (log.userAgent) lines.push(`Browser: ${log.userAgent}`);
  lines.push(`Result: ${summarizeImportErrorLog(log)}`);

  if (log.recovered.length > 0) {
    lines.push("", "Emptied voices (MNX sequences)");
    for (const entry of log.recovered) {
      lines.push("", `[${entry.logId}] ${describeRecoveredSequence(entry)}, sequence ${entry.sequenceIndex + 1}`);
      if (entry.partId) lines.push(`  Part id: ${entry.partId}`);
      if (entry.discardedIds.length > 0) lines.push(`  Discarded ids: ${entry.discardedIds.join(", ")}`);
      lines.push("  Errors:", ...entry.errors.map(formatError));
    }
  }

  if (log.status === "failed") {
    lines.push("", "Errors that prevented opening");
    if (log.failureMessage) lines.push(`    - ${log.failureMessage}`);
    lines.push(...log.fatalErrors.map(formatError));
  }

  if (log.converterWarnings.length > 0) {
    lines.push("", "Converter warnings", ...log.converterWarnings.map((warning) => `    - ${warning}`));
  }
  return `${lines.join("\n")}\n`;
}

/** Download filename for a log, derived from the score filename. */
export function importErrorLogFilename(log: ImportErrorLog): string {
  const base = log.filename.replace(/\.[^.]+$/, "") || "score";
  return `${base}-import-log.txt`;
}

/** Prefilled bug-report URL for the repository's issue form. */
export function buildImportIssueUrl(log: ImportErrorLog, text = formatImportErrorLog(log)): string {
  const source = log.sourceFilename ?? log.filename;
  const urlWith = (evidence: string): string => {
    const params = new URLSearchParams({
      template: "bug.yml",
      title: `[Bug]: Import error in ${source}`,
      description: `${summarizeImportErrorLog(log)}\n\nI expected the file to import without errors.`,
      reproduction: `Import ${source}. Attach the file here if it can be shared.`,
      evidence: `\`\`\`text\n${evidence}\`\`\``,
    });
    return `${IMPORT_ISSUE_URL}?${params.toString()}`;
  };
  const full = urlWith(text);
  if (full.length <= MAX_ISSUE_URL_LENGTH) return full;
  // Encoding expands characters unevenly, so search for the longest prefix
  // whose encoded URL still fits.
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (urlWith(text.slice(0, mid) + TRUNCATION_NOTE).length <= MAX_ISSUE_URL_LENGTH) low = mid;
    else high = mid - 1;
  }
  return urlWith(text.slice(0, low) + TRUNCATION_NOTE);
}
