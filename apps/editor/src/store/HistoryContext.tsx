import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CursorPosition } from "./noteInputStore";
import { HistoryStoreContext, createHistoryStore, type HistoryStore } from "./historyStore";

interface HistoryProviderProps {
  initialMnxJson?: string;
  onRestore?: (mnxJson: string, cursorPosition?: CursorPosition | null) => void;
  children: ReactNode;
}

export function HistoryProvider({ initialMnxJson, onRestore, children }: HistoryProviderProps) {
  // `onRestore` may change identity between renders (callers commonly pass
  // an inline arrow), but the history store is constructed once and calls
  // back from outside React (after the user clicks undo/redo). The ref
  // holds the latest committed handler so the store always sees it.
  const onRestoreRef = useRef(onRestore);
  useEffect(() => {
    onRestoreRef.current = onRestore;
  });

  // Lazy-init the history store exactly once per provider instance. We
  // capture the initial MNX snapshot and the (forward-stable) ref so the
  // store can resolve the current handler at call time.
  const [store] = useState<HistoryStore>(
    // eslint-disable-next-line react-hooks/refs -- the store reads onRestoreRef only from outside-React callbacks (undo/redo), not during render
    () => createHistoryStore(initialMnxJson, onRestoreRef),
  );

  return <HistoryStoreContext.Provider value={store}>{children}</HistoryStoreContext.Provider>;
}
