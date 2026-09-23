import { pasteFromClipboard, pasteResultFromFragment, type PasteResult } from "../commands/clipboardCommands";
import { useClipboardHistoryStore } from "../store/clipboardHistoryStore";
import { NotationClipboardError } from "../clipboard/notationClipboard";

/**
 * Read notation from the system clipboard, falling back to the latest internal
 * clipboard-history entry when browser clipboard access has no notation.
 */
export async function acquireClipboardPaste(onWarning: (message: string) => void): Promise<PasteResult | null> {
  try {
    const systemPaste = await pasteFromClipboard(onWarning);
    if (systemPaste) return systemPaste;
  } catch (error) {
    const latest = useClipboardHistoryStore.getState().entries[0];
    if (latest && error instanceof NotationClipboardError && error.canUseHistory) {
      return pasteResultFromFragment(latest.fragment);
    }
    throw error;
  }
  const latest = useClipboardHistoryStore.getState().entries[0];
  return latest ? pasteResultFromFragment(latest.fragment) : null;
}
