import { useEffect, useRef } from "react";
import type { CursorPosition } from "../store/noteInputStore";
import { useNoteInputStore } from "../store/noteInputStore";
import type { useDocumentStoreApi } from "../store/DocumentContext";

type DocumentStoreApi = ReturnType<typeof useDocumentStoreApi>;
type PushState = (
  mnxJson: string,
  description: string,
  cursorBefore?: CursorPosition | null,
  cursorAfter?: CursorPosition | null,
) => void;

interface UseMnxChangeReporterParams {
  store: DocumentStoreApi;
  onMnxChange?: ((mnx: string) => void) | undefined;
  onFirstLoad?: ((mnx: string) => void) | undefined;
  pushState: PushState;
}

/**
 * Subscribes to the document store and fires:
 * - `onMnxChange` whenever the serialized MNX changes
 * - `onFirstLoad` once, on the first non-empty MNX seen
 * - `pushState` (history snapshot) whenever the change came from a user edit
 *
 * Uses refs internally so changes to the callbacks/noteInputState don't
 * tear down and rebuild the subscription on every render.
 */
export function useMnxChangeReporter(params: UseMnxChangeReporterParams): void {
  const { store, onMnxChange, onFirstLoad, pushState } = params;
  const onMnxChangeRef = useRef(onMnxChange);
  onMnxChangeRef.current = onMnxChange;
  const onFirstLoadRef = useRef(onFirstLoad);
  onFirstLoadRef.current = onFirstLoad;
  const pushStateRef = useRef(pushState);
  pushStateRef.current = pushState;

  useEffect(() => {
    let firstLoadDone = false;
    let prevMnx = store.getState().mnxJson;

    if (prevMnx) {
      onMnxChangeRef.current?.(prevMnx);
      firstLoadDone = true;
      onFirstLoadRef.current?.(prevMnx);
    }

    return store.subscribe((state) => {
      const { mnxJson: currentMnx, dirty: currentDirty } = state;
      if (!currentMnx || currentMnx === prevMnx) return;

      if (currentDirty) {
        const cursorBefore = state.lastEditCursorBefore;
        queueMicrotask(() => {
          pushStateRef.current(currentMnx, "Edit", cursorBefore, useNoteInputStore.getState().cursorPosition);
        });
      }

      onMnxChangeRef.current?.(currentMnx);
      if (!firstLoadDone) {
        firstLoadDone = true;
        onFirstLoadRef.current?.(currentMnx);
      }

      prevMnx = currentMnx;
    });
  }, [store]);
}
