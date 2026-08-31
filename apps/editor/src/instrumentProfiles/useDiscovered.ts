import { useCallback, useEffect, useState } from "react";
import { selectHostBridge, type DiscoveredEntry } from "./profileHostBridge";
import { useScanFoldersStore } from "./scanFoldersStore";

export interface Discovered {
  readonly entries: readonly DiscoveredEntry[];
  readonly loading: boolean;
  readonly refresh: () => void;
}

type ScanKind = "plugins" | "scripts";

/**
 * Scan the given folders for plugins or scripts, re-running whenever the folder
 * list changes or `refresh()` is called. Off the desktop host the bridge returns
 * nothing, so this quietly yields an empty list and callers fall back to Browse.
 */
function useScan(folders: readonly string[], kind: ScanKind): Discovered {
  const [entries, setEntries] = useState<readonly DiscoveredEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const bridge = selectHostBridge();
    setLoading(true);
    const scan = kind === "plugins" ? bridge.scanPlugins(folders) : bridge.scanLuaScripts(folders);
    scan
      .then((found) => {
        if (!cancelled) setEntries(found);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folders, kind, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  return { entries, loading, refresh };
}

/** Installed VST3 plugins discovered across the configured plugin search folders. */
export function useDiscoveredPlugins(): Discovered {
  const folders = useScanFoldersStore((state) => state.pluginFolders);
  return useScan(folders, "plugins");
}

/** Lua articulation scripts discovered across the configured script search folders. */
export function useDiscoveredScripts(): Discovered {
  const folders = useScanFoldersStore((state) => state.luaFolders);
  return useScan(folders, "scripts");
}
