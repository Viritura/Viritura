/* eslint-disable react-refresh/only-export-components --
 * AppShell intentionally colocates its Context with the `useRegister*`
 * hooks every activity view calls to contribute menu/recent-files state.
 * Splitting would fork ~10 view imports without architectural benefit.
 * AppShell rarely changes at runtime so the Fast Refresh cost is minimal. */
/**
 * AppShellContext — manages the global header bar state.
 *
 * The header bar has two regions:
 * 1. MenuBar (left) — always rendered, composed from global document commands
 *    and callbacks contributed by the active activity
 * 2. Toolbar slot (right) — React portal target, content contributed by the active view
 *
 * Persistent document ownership registers global File/Help/save/history
 * commands. Each activity calls useRegisterMenuCallbacks() for commands it owns
 * (selection, zoom, etc.) and renders toolbar content via <ToolbarPortal>.
 * Activity contributions are automatically cleared on unmount.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useReducer,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { MenuBarCallbacks, MenuBarState, RecentMenuEntry } from "../components/MenuBar";
import { MenuBar } from "../components/MenuBar";

const APP_SHELL_ROOT_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  width: "100vw",
  overflow: "hidden",
};
const APP_SHELL_TOOLBAR_STYLE: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  height: "100%",
  minWidth: 0,
};
function appShellHeaderStyle(): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    height: HEADER_HEIGHT,
  };
}

// ═══════════════════════════════════════════
// Context
// ═══════════════════════════════════════════

interface AppShellContextValue {
  setGlobalMenuCallbacks: (cb: MenuBarCallbacks) => void;
  setMenuCallbacks: (cb: MenuBarCallbacks) => void;
  setGlobalMenuState: (state: MenuBarState) => void;
  setMenuState: (state: MenuBarState) => void;
  /** Set the entries shown in File → Open Recent. */
  setRecentEntries: (entries: readonly RecentMenuEntry[]) => void;
  /** The DOM element for the toolbar portal target, null until mounted. */
  toolbarPortalTarget: HTMLDivElement | null;
}

const AppShellContext = createContext<AppShellContextValue>({
  setGlobalMenuCallbacks: () => {},
  setMenuCallbacks: () => {},
  setGlobalMenuState: () => {},
  setMenuState: () => {},
  setRecentEntries: () => {},
  toolbarPortalTarget: null,
});

// ═══════════════════════════════════════════
// AppShell — the global header + content layout
// ═══════════════════════════════════════════

const HEADER_HEIGHT = 44;

interface AppShellProps {
  children: ReactNode;
}

/**
 * Top-level shell that renders the fixed-height header bar
 * (MenuBar + toolbar portal) and the content area below it.
 *
 * Usage:
 * ```tsx
 * <AppShell>
 *   <ActivityBar />
 *   <div className="appshell-main-content">
 *     {activeView === "write" && <App />}
 *     {activeView === "play" && <PlayView />}
 *   </div>
 * </AppShell>
 * ```
 */
export function AppShell({ children }: AppShellProps) {
  // Store callbacks/state in refs so AppShell itself doesn't re-render.
  // MenuBarHeader subscribes to a version counter and re-renders independently.
  const globalMenuCallbacksRef = useRef<MenuBarCallbacks>({});
  const activityMenuCallbacksRef = useRef<MenuBarCallbacks>({});
  const globalMenuStateRef = useRef<MenuBarState>({});
  const activityMenuStateRef = useRef<MenuBarState>({});
  const recentEntriesRef = useRef<readonly RecentMenuEntry[]>([]);
  const menuVersionRef = useRef<(() => void) | null>(null);
  const [toolbarPortalTarget, setToolbarPortalTarget] = useState<HTMLDivElement | null>(null);

  const setGlobalMenuCallbacks = useCallback((cb: MenuBarCallbacks) => {
    globalMenuCallbacksRef.current = cb;
    menuVersionRef.current?.();
  }, []);
  const setMenuCallbacks = useCallback((cb: MenuBarCallbacks) => {
    activityMenuCallbacksRef.current = cb;
    menuVersionRef.current?.();
  }, []);
  const setGlobalMenuState = useCallback((s: MenuBarState) => {
    globalMenuStateRef.current = s;
    menuVersionRef.current?.();
  }, []);
  const setMenuState = useCallback((s: MenuBarState) => {
    activityMenuStateRef.current = s;
    menuVersionRef.current?.();
  }, []);
  const setRecentEntries = useCallback((entries: readonly RecentMenuEntry[]) => {
    recentEntriesRef.current = entries;
    menuVersionRef.current?.();
  }, []);

  // Callback ref — fires once when the div mounts, providing a stable reference
  const toolbarRef = useCallback((node: HTMLDivElement | null) => {
    setToolbarPortalTarget(node);
  }, []);

  return (
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={100}>
      <AppShellContext.Provider
        value={{
          setGlobalMenuCallbacks,
          setMenuCallbacks,
          setGlobalMenuState,
          setMenuState,
          setRecentEntries,
          toolbarPortalTarget,
        }}
      >
        <div style={APP_SHELL_ROOT_STYLE}>
          {/* Fixed-height header: MenuBar (global) + Toolbar (view-specific portal) */}
          <MenuBarHeader
            globalCallbacksRef={globalMenuCallbacksRef}
            activityCallbacksRef={activityMenuCallbacksRef}
            globalStateRef={globalMenuStateRef}
            activityStateRef={activityMenuStateRef}
            recentEntriesRef={recentEntriesRef}
            versionRef={menuVersionRef}
            toolbarRef={toolbarRef}
          />
          {/* Content area */}
          {children}
        </div>
      </AppShellContext.Provider>
    </RadixTooltip.Provider>
  );
}

/**
 * Isolated header component that re-renders independently from AppShell children.
 * When menu callbacks or state change, only this component re-renders (via version counter),
 * not the entire AppShell subtree.
 */
function MenuBarHeader({
  globalCallbacksRef,
  activityCallbacksRef,
  globalStateRef,
  activityStateRef,
  recentEntriesRef,
  versionRef,
  toolbarRef,
}: {
  globalCallbacksRef: React.RefObject<MenuBarCallbacks>;
  activityCallbacksRef: React.RefObject<MenuBarCallbacks>;
  globalStateRef: React.RefObject<MenuBarState>;
  activityStateRef: React.RefObject<MenuBarState>;
  recentEntriesRef: React.RefObject<readonly RecentMenuEntry[]>;
  versionRef: React.MutableRefObject<(() => void) | null>;
  toolbarRef: (node: HTMLDivElement | null) => void;
}) {
  const [, bump] = useReducer((c: number) => c + 1, 0);

  // Register the bump function so the parent can trigger re-renders
  useEffect(() => {
    versionRef.current = bump;
    return () => {
      versionRef.current = null;
    };
  }, [versionRef]);

  // eslint-disable-next-line react-hooks/refs -- the version bump is the subscription; refs hold its latest snapshot
  const callbacks = { ...globalCallbacksRef.current, ...activityCallbacksRef.current };
  // eslint-disable-next-line react-hooks/refs -- the version bump is the subscription; refs hold its latest snapshot
  const state = { ...globalStateRef.current, ...activityStateRef.current };
  // eslint-disable-next-line react-hooks/refs -- the version bump is the subscription; refs hold its latest snapshot
  const recentEntries = recentEntriesRef.current;

  return (
    <div className="app-chrome app-chrome--top" style={appShellHeaderStyle()}>
      {/* eslint-disable-next-line react-hooks/refs -- values are snapshots from the version-bumped external ref store */}
      <MenuBar callbacks={callbacks} state={state} recentEntries={recentEntries} />
      <div ref={toolbarRef} style={APP_SHELL_TOOLBAR_STYLE} />
    </div>
  );
}

// ═══════════════════════════════════════════
// Hooks for views
// ═══════════════════════════════════════════

/**
 * Register active-activity callbacks for the global MenuBar.
 * Automatically clears on unmount so view switches reset the menu.
 *
 * Usage:
 * ```tsx
 * function WriteView() {
 *   const callbacks = useMemo(() => ({
 *     onSave: handleSave,
 *     onUndo: handleUndo,
 *     // ...
 *   }), [handleSave, handleUndo]);
 *   useRegisterMenuCallbacks(callbacks);
 * }
 * ```
 */
export function useRegisterMenuCallbacks(callbacks: MenuBarCallbacks) {
  const { setMenuCallbacks } = useContext(AppShellContext);

  // Clear on unmount so a view switch resets the menu. `setMenuCallbacks`
  // is stable (useCallback in AppShell), so this only runs on mount/unmount.
  useEffect(() => {
    return () => setMenuCallbacks({});
  }, [setMenuCallbacks]);

  // Push the latest callbacks on every change (including initial mount).
  useEffect(() => {
    setMenuCallbacks(callbacks);
  }, [callbacks, setMenuCallbacks]);
}

/** Register commands that remain available while switching activities. */
export function useRegisterGlobalMenuCallbacks(callbacks: MenuBarCallbacks) {
  const { setGlobalMenuCallbacks } = useContext(AppShellContext);

  useEffect(() => () => setGlobalMenuCallbacks({}), [setGlobalMenuCallbacks]);
  useEffect(() => setGlobalMenuCallbacks(callbacks), [callbacks, setGlobalMenuCallbacks]);
}

/**
 * Register menu state for the global MenuBar.
 * Automatically clears on unmount.
 */
export function useRegisterMenuState(state: MenuBarState) {
  const { setMenuState } = useContext(AppShellContext);

  useEffect(() => {
    return () => setMenuState({});
  }, [setMenuState]);

  useEffect(() => {
    setMenuState(state);
  }, [state, setMenuState]);
}

/** Register document state shared by every activity (save/undo availability). */
export function useRegisterGlobalMenuState(state: MenuBarState) {
  const { setGlobalMenuState } = useContext(AppShellContext);

  useEffect(() => () => setGlobalMenuState({}), [setGlobalMenuState]);
  useEffect(() => setGlobalMenuState(state), [state, setGlobalMenuState]);
}

/**
 * Register the entries shown in the File → Open Recent submenu of the
 * global MenuBar. Pass an empty array to clear. Cleared automatically when
 * the calling view unmounts so other views don't inherit stale recents.
 */
export function useRegisterRecentEntries(entries: readonly RecentMenuEntry[]) {
  const { setRecentEntries } = useContext(AppShellContext);

  useEffect(() => {
    return () => setRecentEntries([]);
  }, [setRecentEntries]);

  useEffect(() => {
    setRecentEntries(entries);
  }, [entries, setRecentEntries]);
}

// ═══════════════════════════════════════════
// ToolbarPortal — render view-specific toolbar content
// ═══════════════════════════════════════════

/**
 * Renders children into the toolbar slot of the global header bar.
 *
 * Usage:
 * ```tsx
 * function WriteView() {
 *   return (
 *     <>
 *       <ToolbarPortal>
 *         <NoteInputToolbar />
 *         <TransportMini />
 *       </ToolbarPortal>
 *       <ScoreCanvas />
 *     </>
 *   );
 * }
 * ```
 */
export function ToolbarPortal({ children }: { children: ReactNode }) {
  const { toolbarPortalTarget } = useContext(AppShellContext);
  if (!toolbarPortalTarget) return null;
  return createPortal(children, toolbarPortalTarget);
}
