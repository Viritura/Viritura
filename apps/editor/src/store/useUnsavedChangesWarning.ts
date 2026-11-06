import { useEffect } from "react";
import type { DocumentStore } from "./documentStore";

export function useUnsavedChangesWarning(store: DocumentStore): void {
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Older browsers also require returnValue to request their native dialog.
      event.returnValue = "";
    };
    let listening = false;
    const updateListener = (): void => {
      const { mnxJson, savedMnxJson, workingScore, score } = store.getState();
      const unsaved = mnxJson !== savedMnxJson || workingScore !== score;
      if (unsaved === listening) return;
      listening = unsaved;
      if (unsaved) window.addEventListener("beforeunload", handleBeforeUnload);
      else window.removeEventListener("beforeunload", handleBeforeUnload);
    };
    updateListener();
    const unsubscribe = store.subscribe(updateListener);
    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [store]);
}
