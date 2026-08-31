import { useMemo, useState } from "react";
import { Settings, X } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogSplitAside,
  DialogSplitBody,
  DialogSplitMain,
  DialogSplitMainHeader,
  NavList,
  SearchInput,
} from "@viritura/ui";
import { availableCategories } from "./settingsCategories";
import { filterCategories, toNavGroups } from "./categoryFilter";
import { useSettingsCategoryStore } from "./settingsCategoryStore";
import styles from "./SettingsDialog.module.css";

const PANEL_ID_PREFIX = "settings-panel";

export interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * Two-pane settings shell: category rail on the left, one panel on the right.
 *
 * Everything is derived from `settingsCategories` — the rail, the search
 * index, and which panel mounts — so a new settings area is a single registry
 * entry. Only the active panel is mounted, keeping unavailable host-specific
 * preferences off the critical path.
 *
 * All preferences apply instantly; there is deliberately no OK/Cancel.
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const activeCategoryId = useSettingsCategoryStore((s) => s.activeCategoryId);
  const setActiveCategory = useSettingsCategoryStore((s) => s.setActiveCategory);
  const [query, setQuery] = useState("");

  const categories = useMemo(() => availableCategories(), []);
  const matches = useMemo(() => filterCategories(categories, query), [categories, query]);
  const navGroups = useMemo(() => toNavGroups(matches), [matches]);

  // The stored id can fall outside the current host's categories (a desktop
  // category remembered in a browser session), so fall back to the first one.
  const active = categories.find((category) => category.id === activeCategoryId) ?? categories[0];
  const ActivePanel = active?.Panel;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xwide"
      onEscapeKeyDown={(event) => {
        // Escape clears an active search first; a second press closes.
        if (query !== "") {
          event.preventDefault();
          setQuery("");
        }
      }}
    >
      <DialogHeader title="Settings" onClose={onClose} closeIcon={<X size={14} />}>
        <span className={styles.headerMeta}>
          <Settings size={14} />
          Editor
        </span>
      </DialogHeader>

      <DialogSplitBody>
        <DialogSplitAside ariaLabel="Settings categories">
          <SearchInput
            size="sm"
            value={query}
            onValueChange={setQuery}
            placeholder="Search settings"
            className={styles.search}
          />
          {navGroups.length === 0 ? (
            <p className={styles.noResults}>No settings match “{query}”.</p>
          ) : (
            <NavList
              groups={navGroups}
              value={active?.id ?? ""}
              onChange={setActiveCategory}
              ariaLabel="Settings categories"
              panelIdPrefix={PANEL_ID_PREFIX}
            />
          )}
        </DialogSplitAside>

        <DialogSplitMain id={`${PANEL_ID_PREFIX}-${active?.id ?? ""}`}>
          {active && ActivePanel && (
            <>
              <DialogSplitMainHeader title={active.label} description={active.description} />
              <ActivePanel />
            </>
          )}
        </DialogSplitMain>
      </DialogSplitBody>
    </Dialog>
  );
}
