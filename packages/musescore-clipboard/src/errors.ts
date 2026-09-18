export type MuseScoreErrorCode =
  | "malformed-xml"
  | "unsafe-xml"
  | "unsupported-version"
  | "unsupported-content"
  | "invalid-timing"
  | "invalid-pitch"
  | "invalid-structure";

export class MuseScoreConversionError extends Error {
  readonly code: MuseScoreErrorCode;
  readonly path?: string;
  readonly sourceTime?: string;

  constructor(code: MuseScoreErrorCode, message: string, path?: string, sourceTime?: string) {
    super(message);
    this.name = "MuseScoreConversionError";
    this.code = code;
    this.path = path;
    this.sourceTime = sourceTime;
  }

  userMessage(): string {
    const context = [this.path, this.sourceTime ? `at ${this.sourceTime}` : undefined].filter(Boolean).join(" ");
    return `MuseScore clipboard: ${this.message}${context ? ` (${context})` : ""}`;
  }
}

export function unsupported(message: string, path?: string, sourceTime?: string): never {
  throw new MuseScoreConversionError("unsupported-content", message, path, sourceTime);
}
