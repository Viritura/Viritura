/**
 * Re-export of @viritura/core diagnostics. Kept here to avoid breaking the
 * `./mnx/diagnostics` import path used by the parser; new code should import
 * from `@viritura/core` (or via `@viritura/format`'s top-level re-export).
 */
export { DiagnosticCollector, ptr, ptrChild, type MnxDiagnostic, type DiagnosticSeverity } from "@viritura/core";
