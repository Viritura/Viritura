import { create } from "zustand";
import type { ImportErrorLog } from "./importErrorLog";

interface ImportErrorLogState {
  /** Log shown in the import error dialog, or null when it is closed. */
  log: ImportErrorLog | null;
}

export const useImportErrorLogStore = create<ImportErrorLogState>(() => ({ log: null }));

/** Open the import error dialog for `log`, replacing any log already shown. */
export const showImportErrorLog = (log: ImportErrorLog): void => useImportErrorLogStore.setState({ log });

export const dismissImportErrorLog = (): void => useImportErrorLogStore.setState({ log: null });
