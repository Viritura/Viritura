import { useEffect } from "react";
import { useStore } from "zustand";
import { hasUnsavedChanges, type DocumentStore } from "../store/documentStore";

export function useDocumentTitle(store: DocumentStore): void {
  const scoreName = useStore(store, (state) => state.score?.metadata?.title?.trim() || state.fileName || "Untitled");
  const dirty = useStore(store, hasUnsavedChanges);

  useEffect(() => {
    const appWindow = window.matchMedia(
      "(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)",
    );
    const updateTitle = (): void => {
      document.title = `${scoreName}${dirty ? " \u2022" : ""}${appWindow.matches ? "" : " \u2014 Viritura"}`;
    };
    updateTitle();
    appWindow.addEventListener("change", updateTitle);
    return () => appWindow.removeEventListener("change", updateTitle);
  }, [scoreName, dirty]);
}
