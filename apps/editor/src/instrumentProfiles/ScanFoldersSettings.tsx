import { useEffect, useMemo } from "react";
import { Button, Text } from "@viritura/ui";
import { selectHostBridge } from "./profileHostBridge";
import { useScanFoldersStore } from "./scanFoldersStore";
import styles from "./instrumentProfiles.module.css";

function FolderList({
  title,
  folders,
  onAdd,
  onRemove,
}: {
  title: string;
  folders: readonly string[];
  onAdd: () => void;
  onRemove: (path: string) => void;
}) {
  return (
    <div className={styles.folderGroup}>
      <div className={styles.folderGroupHeader}>
        <span className={styles.sectionTitle}>{title}</span>
        <Button label="Add folder…" onClick={onAdd} />
      </div>
      {folders.length === 0 ? (
        <div className={styles.emptySection}>No folders yet. Use “Add folder…”.</div>
      ) : (
        <div className={styles.slotRows}>
          {folders.map((folder) => (
            <div key={folder} className={styles.folderRow}>
              <span className={styles.folderPath}>{folder}</span>
              <Button label="Remove" onClick={() => onRemove(folder)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * DAW-style search-folder settings: the folders scanned for installed VST3
 * plugins and Lua articulation scripts. Seeded once with the platform defaults
 * (the standard VST3 location, the user's Viritura `Articulations` folder, and the
 * bundled examples); the Configure panel's pickers list whatever these folders
 * contain. Desktop-only — the web build cannot scan the filesystem.
 */
export function ScanFoldersSettings() {
  const bridge = useMemo(() => selectHostBridge(), []);
  const pluginFolders = useScanFoldersStore((state) => state.pluginFolders);
  const luaFolders = useScanFoldersStore((state) => state.luaFolders);
  const addPluginFolder = useScanFoldersStore((state) => state.addPluginFolder);
  const removePluginFolder = useScanFoldersStore((state) => state.removePluginFolder);
  const addLuaFolder = useScanFoldersStore((state) => state.addLuaFolder);
  const removeLuaFolder = useScanFoldersStore((state) => state.removeLuaFolder);
  const ensureSeeded = useScanFoldersStore((state) => state.ensureSeeded);

  useEffect(() => {
    void ensureSeeded();
  }, [ensureSeeded]);

  const addFolder = async (add: (path: string) => void) => {
    const path = await bridge.pickFolder();
    if (path) add(path);
  };

  return (
    <div className={styles.scanFolders}>
      <Text variant="eyebrow" tone="muted">
        Folders searched for plugins and articulation scripts, shown in the Configure pickers.
      </Text>
      <FolderList
        title="VST plugin folders"
        folders={pluginFolders}
        onAdd={() => void addFolder(addPluginFolder)}
        onRemove={removePluginFolder}
      />
      <FolderList
        title="Lua script folders"
        folders={luaFolders}
        onAdd={() => void addFolder(addLuaFolder)}
        onRemove={removeLuaFolder}
      />
    </div>
  );
}
