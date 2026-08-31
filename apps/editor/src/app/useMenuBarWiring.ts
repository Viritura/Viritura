import { useMemo } from "react";
import { useMenuBarConfig, type MenuBarConfigDeps } from "./useMenuBarConfig";
import {
  useRegisterGlobalMenuCallbacks,
  useRegisterGlobalMenuState,
  useRegisterMenuCallbacks,
  useRegisterMenuState,
  useRegisterRecentEntries,
} from "../components/AppShell";
import type { MenuBarCallbacks, MenuBarState } from "../components/MenuBar";

interface UseMenuBarWiringParams extends MenuBarConfigDeps {
  isActiveView: boolean | undefined;
  supportsWritePanels: boolean;
}

/**
 * Build MenuBar config, keep document-level commands registered globally, and
 * contribute notation/viewport commands only while this workspace is active.
 */
export function useMenuBarWiring({ isActiveView, supportsWritePanels, ...deps }: UseMenuBarWiringParams): void {
  const { menuCallbacks, menuState, recentMenuEntries } = useMenuBarConfig(deps);

  const emptyCallbacks = useMemo<MenuBarCallbacks>(() => ({}), []);
  const emptyState = useMemo<MenuBarState>(() => ({}), []);
  const globalCallbacks = useMemo(() => globalMenuCallbacks(menuCallbacks), [menuCallbacks]);
  const activityCallbacks = useMemo(
    () => activityMenuCallbacks(menuCallbacks, supportsWritePanels),
    [menuCallbacks, supportsWritePanels],
  );
  const globalState = useMemo(
    () => ({
      hasDocument: menuState.hasDocument,
      canUndo: menuState.canUndo,
      canRedo: menuState.canRedo,
    }),
    [menuState],
  );

  useRegisterGlobalMenuCallbacks(globalCallbacks);
  useRegisterGlobalMenuState(globalState);
  useRegisterRecentEntries(recentMenuEntries);
  useRegisterMenuCallbacks(isActiveView ? activityCallbacks : emptyCallbacks);
  useRegisterMenuState(isActiveView ? menuState : emptyState);
}

const GLOBAL_CALLBACK_KEYS = [
  "onNewScore",
  "onOpenFile",
  "onOpenProject",
  "onImport",
  "onShowStartCenter",
  "onSelectRecentEntry",
  "onSave",
  "onSaveAs",
  "onShowHelp",
  "onOpenDocs",
  "onOpenPublish",
] as const satisfies readonly (keyof MenuBarCallbacks)[];

export function globalMenuCallbacks(callbacks: MenuBarCallbacks): MenuBarCallbacks {
  return Object.fromEntries(
    GLOBAL_CALLBACK_KEYS.flatMap((key) => (callbacks[key] ? [[key, callbacks[key]]] : [])),
  ) as MenuBarCallbacks;
}

export function activityMenuCallbacks(callbacks: MenuBarCallbacks, supportsWritePanels: boolean): MenuBarCallbacks {
  if (supportsWritePanels) return callbacks;
  const { onToggleSource: _source, ...activityCallbacks } = callbacks;
  return activityCallbacks;
}
