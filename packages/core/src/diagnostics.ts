/**
 * Generic conversion / parse diagnostics, shared across @viritura/format and
 * @viritura/musicxml. Surfaces lossy decisions (dropped fields, fallback
 * substitutions, schema violations) so callers (UIs, CLIs, tests) can report
 * them. Not coupled to any particular importer's logging convention — the
 * shape (severity + RFC 6901 pointer + optional code) is general.
 */

export type DiagnosticSeverity = "info" | "warning" | "error";

/** A single conversion diagnostic. */
export interface MnxDiagnostic {
  /** RFC 6901 JSON Pointer to the offending node, e.g. `/parts/0/measures/2`. */
  pointer: string;
  /** Human-readable message. Should describe what was dropped or substituted. */
  message: string;
  severity: DiagnosticSeverity;
  /** Stable code for filtering in tooling (e.g. `"unsupported-clef"`). */
  code?: string;
}

/**
 * Mutable collector passed through importers / parsers. Use {@link emit}
 * for the common case; instances are stack-local — there's no global state.
 */
export class DiagnosticCollector {
  private readonly entries: MnxDiagnostic[] = [];

  emit(d: MnxDiagnostic): void {
    this.entries.push(d);
  }

  warn(pointer: string, message: string, code?: string): void {
    this.entries.push({ pointer, message, severity: "warning", code });
  }

  info(pointer: string, message: string, code?: string): void {
    this.entries.push({ pointer, message, severity: "info", code });
  }

  error(pointer: string, message: string, code?: string): void {
    this.entries.push({ pointer, message, severity: "error", code });
  }

  /** Returns a snapshot of the collected diagnostics in emission order. */
  all(): readonly MnxDiagnostic[] {
    return this.entries.slice();
  }

  get length(): number {
    return this.entries.length;
  }
}

/**
 * Build a JSON Pointer by appending segments. Segments are escaped per
 * RFC 6901 (`~` → `~0`, `/` → `~1`). Numbers are stringified.
 */
export function ptr(...segments: Array<string | number>): string {
  if (segments.length === 0) return "";
  return "/" + segments.map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}

/**
 * Compose a child pointer onto an existing parent pointer.
 */
export function ptrChild(parent: string, ...segments: Array<string | number>): string {
  return parent + ptr(...segments);
}
