import { MuseScoreConversionError } from "./errors";
import type { MuseScoreClipboardDiagnostic, MuseScoreClipboardReadOptions } from "./types";

/** Per-read state: recovery never changes strict import or export in another call. */
export class ReadPolicy {
  readonly skipUnsupported: boolean;
  readonly diagnostics: MuseScoreClipboardDiagnostic[] = [];

  constructor(options: MuseScoreClipboardReadOptions = {}) {
    this.skipUnsupported = options.unsupported === "skip";
  }

  skip(message: string, path?: string, sourceTime?: string): void {
    if (!this.skipUnsupported) throw new MuseScoreConversionError("unsupported-content", message, path, sourceTime);
    this.diagnostics.push({
      code: "unsupported-content",
      message,
      ...(path === undefined ? {} : { path }),
      ...(sourceTime === undefined ? {} : { sourceTime }),
    });
  }

  /** Only use at an atomic notation boundary, before attaching it to retained material. */
  recover<T>(operation: () => T): T | undefined {
    try {
      return operation();
    } catch (error) {
      if (!(error instanceof MuseScoreConversionError) || error.code !== "unsupported-content") throw error;
      this.skip(error.message, error.path, error.sourceTime);
      return undefined;
    }
  }
}
