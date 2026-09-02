import type { MnxDocument, MnxDiagnostic } from "@viritura/musicxml";

export interface ConvertedFile {
  /** Original source file ref (kept so toggle changes can re-run conversion). */
  source: File;
  name: string;
  size: number;
  result: MnxDocument | null;
  error: string | null;
  status: "pending" | "converting" | "success" | "error";
  diagnostics: readonly MnxDiagnostic[];
  /** The vendor-extension flag value used to produce this result. Lets us
   *  detect when the toggle has flipped and we need to re-convert. */
  vendorExtUsed: boolean;
  /** The discard-stem-directions flag used to produce this result. Same
   *  staleness purpose as `vendorExtUsed`. */
  discardStemsUsed: boolean;
  /** The hide-metronome-when-tempo-text flag used to produce this result.
   *  Same staleness purpose as `vendorExtUsed`. */
  hideMetronomeUsed: boolean;
}

export type TabId = "preview" | "diagnostics" | "mnx";

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
