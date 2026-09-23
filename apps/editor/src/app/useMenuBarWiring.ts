import { useCallback, useMemo } from "react";
import { useMenuBarConfig, type MenuBarConfigDeps } from "./useMenuBarConfig";
import { buildSelectionContextMenuItems } from "../components/selectionContextMenuItems";
import type { SelectionMenuContext } from "../components/ScoreCanvas";
import type { MenuItemDef } from "@viritura/ui";
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

export interface MenuBarWiring {
  /**
   * Build the score context-menu items from the same callbacks and state the
   * menu bar uses, so a command cannot be enabled in one surface and disabled
   * in the other.
   */
  buildSelectionMenuItems: (context: SelectionMenuContext) => readonly MenuItemDef[];
}

/**
 * Build MenuBar config, keep document-level commands registered globally, and
 * contribute notation/viewport commands only while this workspace is active.
 */
export function useMenuBarWiring({
  isActiveView,
  supportsWritePanels,
  ...deps
}: UseMenuBarWiringParams): MenuBarWiring {
  const config = useMenuBarConfig(deps);
  const { menuCallbacks, menuState, recentMenuEntries } = config;

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

  const buildSelectionMenuItems = useCallback(
    // Built on open so item state reflects the selection at right-click time.
    (context: SelectionMenuContext) => buildSelectionContextMenuItems(menuCallbacks, menuState, context),
    [menuCallbacks, menuState],
  );
  return { buildSelectionMenuItems };
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
  "onShare",
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
