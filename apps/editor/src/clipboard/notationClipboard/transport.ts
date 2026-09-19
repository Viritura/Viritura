import {
  readNativeNotationClipboard,
  writeNativeNotationClipboard,
  type NativeMuseScoreClipboard,
} from "./tauriBackend";

export class NotationClipboardError extends Error {
  readonly backend: "native" | "browser";
  readonly canUseHistory: boolean;

  constructor(operation: "read" | "write", backend: "native" | "browser", cause: unknown) {
    super(`Could not ${operation} the system clipboard.`, { cause });
    this.name = "NotationClipboardError";
    this.backend = backend;
    this.canUseHistory = operation === "read" && (backend === "browser" || isNativeReadUnavailable(cause));
  }
}

function isNativeReadUnavailable(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  // The native bridge currently rejects with strings. Only documented transport
  // failures permit history fallback; malformed payloads and unknown errors do not.
  return /^(?:failed to (?:open|close) clipboard:|failed to get clipboard data:|failed to (?:lock|unlock) clipboard global memory:|failed to get main window handle:|failed to register clipboard format:|native clipboard unavailable\b|clipboard permission denied\b)/i.test(
    message,
  );
}

export interface NotationClipboardContents {
  text: string;
  museScore: NativeMuseScoreClipboard | null;
  nativeFormatsSupported: boolean;
}

export interface NotationClipboardWrite {
  text: string;
}

export async function readNotationClipboard(): Promise<NotationClipboardContents> {
  let native;
  try {
    native = await readNativeNotationClipboard();
  } catch (error) {
    throw new NotationClipboardError("read", "native", error);
  }
  if (native?.supported) {
    return {
      text: native.text ?? "",
      museScore: native.museScore,
      nativeFormatsSupported: true,
    };
  }
  try {
    return { text: await navigator.clipboard.readText(), museScore: null, nativeFormatsSupported: false };
  } catch (error) {
    throw new NotationClipboardError("read", "browser", error);
  }
}

export async function writeNotationClipboard(payload: NotationClipboardWrite): Promise<void> {
  let nativeSupported;
  try {
    nativeSupported = await writeNativeNotationClipboard(payload);
  } catch (error) {
    throw new NotationClipboardError("write", "native", error);
  }
  if (nativeSupported) return;
  try {
    await navigator.clipboard.writeText(payload.text);
  } catch (error) {
    throw new NotationClipboardError("write", "browser", error);
  }
}
