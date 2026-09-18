export interface NativeMuseScoreClipboard {
  mime: string;
  xml: string;
}

export interface NativeNotationClipboardRead {
  supported: boolean;
  text: string | null;
  museScore: NativeMuseScoreClipboard | null;
}

export interface NativeNotationClipboardWrite {
  text: string;
  museScore: NativeMuseScoreClipboard | null;
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

export async function readNativeNotationClipboard(): Promise<NativeNotationClipboardRead | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<NativeNotationClipboardRead>("notation_clipboard_read");
}

export async function writeNativeNotationClipboard(payload: NativeNotationClipboardWrite): Promise<boolean | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const result = await invoke<{ supported: boolean }>("notation_clipboard_write", {
    text: payload.text,
    museScore: payload.museScore,
  });
  return result.supported;
}
