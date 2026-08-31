import type { PluginIdentity } from "@viritura/instrument-profiles";
import type { FxChannelId } from "./fxChainStore";
import { requestPathInput } from "./pathPrompt";

interface PickedPlugin {
  readonly path: string;
  readonly identity: PluginIdentity;
}

/** A plugin or script discovered by scanning the configured search folders. */
export interface DiscoveredEntry {
  readonly name: string;
  readonly path: string;
}

/** Platform-default scan folders used to seed the settings on first run. */
interface ScanFolderDefaults {
  readonly pluginFolders: readonly string[];
  readonly luaFolders: readonly string[];
}

/**
 * The native-host operations the profile editor needs but that only a desktop
 * (Tauri) build can perform: OS file pickers, loading a plugin to read its
 * identity, and the edit-and-listen state capture. The browser fallback stays a
 * no-op host; the desktop bridge drives the in-process VST3 host over Tauri IPC.
 *
 * These methods deal only in native host I/O (paths, identity, opaque state
 * bytes). Content-addressed persistence of the captured bytes is the store's job
 * (see `putInstrumentProfileState`), keeping this port free of storage concerns.
 */
export interface ProfileHostBridge {
  /** Whether a real native host is present (gates hosting-only affordances). */
  readonly isDesktop: boolean;
  /** Pick a `.lua` mapper; resolves to an absolute path or `null` if cancelled. */
  pickLuaScript(): Promise<string | null>;
  /** Pick a `.vst3` plugin and read its identity, or `null` if cancelled. */
  pickPlugin(): Promise<PickedPlugin | null>;
  /** Read a plugin's identity given its path (used by the discovered-list picker). */
  identifyPlugin(path: string): Promise<PickedPlugin | null>;
  /** Pick a folder to add to a scan list; resolves to a path or `null` (desktop only). */
  pickFolder(): Promise<string | null>;
  /** Scan the given folders for installed VST3 plugins (`[]` in the browser). */
  scanPlugins(folders: readonly string[]): Promise<DiscoveredEntry[]>;
  /** Scan the given folders for Lua articulation scripts (`[]` in the browser). */
  scanLuaScripts(folders: readonly string[]): Promise<DiscoveredEntry[]>;
  /** Platform-default scan folders to seed the settings with (empty in the browser). */
  defaultScanFolders(): Promise<ScanFolderDefaults>;
  /**
   * Open the plugin's editor with live audio (edit-and-listen) and return the
   * serialized plugin state captured when the user closes the window. When
   * `existingState` is supplied it is restored first so edits are incremental.
   * Resolves to `null` in the browser (state capture is desktop-only).
   */
  captureState(args: { pluginPath: string; existingState?: Uint8Array }): Promise<Uint8Array | null>;
  /**
   * Open an FX-chain plugin's editor in a *modeless* window on the playback host
   * thread, so it can be tweaked while playback runs without freezing the app
   * (unlike {@link captureState}, which is blocking edit-and-listen). The plugin
   * is identified by its `channel` and `index` within that channel's chain, which
   * must already be loaded on the host (via `set_reverb_chain`/`set_master_chain`).
   * Only one FX editor is open at a time; opening another closes the previous one.
   * The edited state is delivered later via the `vst-fx-editor-closed` event when
   * the window is closed, not returned here. No-op in the browser.
   */
  showFxEditor(args: { channel: FxChannelId; index: number }): Promise<void>;
  /** Close the open FX editor if any (its edited state arrives via the event). */
  closeFxEditor(): Promise<void>;
}

/** Detects whether the app is running inside the Tauri desktop shell. */
export function isDesktopHost(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

/** Picks the desktop bridge when running under Tauri, else the browser fallback. */
export function selectHostBridge(): ProfileHostBridge {
  return isDesktopHost() ? createDesktopHostBridge() : createBrowserHostBridge();
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** Identity the native `vst_load_identity` command reports (camelCase serde). */
interface NativeVstIdentity {
  readonly name: string;
  readonly pluginId: string;
  readonly vendor: string;
  readonly version: string;
  readonly hasEditor: boolean;
}

/**
 * Desktop bridge backed by Tauri: a real OS file explorer (via the dialog
 * plugin) plus the in-process VST3 host commands (`vst_load_identity`,
 * `vst_capture_state`) and folder scanning (`scan_plugins`, `scan_lua_scripts`).
 * On Windows a `.vst3` plugin is in practice a single file, so the plugin picker
 * selects a file filtered to `.vst3`/`.dll`, and the `.lua` mapper picks a `.lua`
 * file. In normal use, though, both are chosen from the discovered-list picker
 * fed by the configured search folders (the way DAWs present their plugin list).
 *
 * Tauri modules are imported lazily so the web bundle never eagerly loads a
 * Tauri-only dependency.
 */
function createDesktopHostBridge(): ProfileHostBridge {
  async function openDialog(options: {
    directory: boolean;
    title: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ multiple: false, ...options });
    return typeof selected === "string" ? selected : null;
  }

  return {
    isDesktop: true,
    async pickLuaScript(): Promise<string | null> {
      return openDialog({
        directory: false,
        title: "Select Lua articulation-map script",
        filters: [{ name: "Lua script", extensions: ["lua"] }],
      });
    },
    async pickPlugin(): Promise<PickedPlugin | null> {
      const path = await openDialog({
        directory: false,
        title: "Select .vst3 plugin",
        filters: [{ name: "VST3 plugin", extensions: ["vst3", "dll"] }],
      });
      if (!path) return null;
      return this.identifyPlugin(path);
    },
    async identifyPlugin(path: string): Promise<PickedPlugin | null> {
      const { invoke } = await import("@tauri-apps/api/core");
      const identity = await invoke<NativeVstIdentity>("vst_load_identity", { pluginPath: path });
      return {
        path,
        identity: {
          format: "vst3",
          pluginId: identity.pluginId,
          vendor: identity.vendor,
          version: identity.version,
        },
      };
    },
    async pickFolder(): Promise<string | null> {
      return openDialog({ directory: true, title: "Select a search folder" });
    },
    async scanPlugins(folders): Promise<DiscoveredEntry[]> {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<DiscoveredEntry[]>("scan_plugins", { folders: [...folders] });
    },
    async scanLuaScripts(folders): Promise<DiscoveredEntry[]> {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<DiscoveredEntry[]>("scan_lua_scripts", { folders: [...folders] });
    },
    async defaultScanFolders(): Promise<ScanFolderDefaults> {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<ScanFolderDefaults>("default_scan_folders", {});
    },
    async captureState({ pluginPath, existingState }): Promise<Uint8Array | null> {
      const { invoke } = await import("@tauri-apps/api/core");
      const bytes = await invoke<number[]>("vst_capture_state", {
        pluginPath,
        existingState: existingState ? Array.from(existingState) : null,
      });
      return bytes.length > 0 ? Uint8Array.from(bytes) : null;
    },
    async showFxEditor({ channel, index }): Promise<void> {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("vst_playback_show_fx_editor", { channel, index });
    },
    async closeFxEditor(): Promise<void> {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("vst_playback_close_fx_editor", {});
    },
  };
}

/**
 * A no-native-host bridge for the web build and Storybook. File pickers fall
 * back to asking for a path (browsers withhold real paths from file inputs, so
 * typing one is the only option here); plugin identity is a filename-derived
 * placeholder; state capture is unavailable (desktop-only).
 */
function createBrowserHostBridge(): ProfileHostBridge {
  return {
    isDesktop: false,
    async pickLuaScript(): Promise<string | null> {
      return requestPathInput({
        title: "Lua articulation script",
        description: "Type the full path to a .lua articulation-map script. The desktop app opens a file picker here.",
        placeholder: "/path/to/script.lua",
      });
    },
    async pickPlugin(): Promise<PickedPlugin | null> {
      const path = await requestPathInput({
        title: "VST plugin",
        description: "Type the full path to a .vst3 plugin. The desktop app opens a file picker here.",
        placeholder: "/path/to/plugin.vst3",
      });
      if (!path) return null;
      return this.identifyPlugin(path);
    },
    async identifyPlugin(path: string): Promise<PickedPlugin | null> {
      const trimmed = path.trim();
      if (trimmed.length === 0) return null;
      return {
        path: trimmed,
        identity: { format: "vst3", pluginId: `placeholder:${fileNameOf(trimmed)}` },
      };
    },
    async pickFolder(): Promise<string | null> {
      return requestPathInput({
        title: "Search folder",
        description: "Type the full path to a folder to search. The desktop app opens a folder picker here.",
        placeholder: "/path/to/folder",
      });
    },
    // Folder scanning is a native capability; the web build has no filesystem
    // access, so it discovers nothing and callers fall back to the path prompts.
    async scanPlugins(): Promise<DiscoveredEntry[]> {
      return [];
    },
    async scanLuaScripts(): Promise<DiscoveredEntry[]> {
      return [];
    },
    async defaultScanFolders(): Promise<ScanFolderDefaults> {
      return { pluginFolders: [], luaFolders: [] };
    },
    async captureState(): Promise<Uint8Array | null> {
      // Edit-and-listen state capture requires the native desktop VST host.
      return null;
    },
    async showFxEditor(): Promise<void> {
      // The modeless FX editor requires the native desktop VST host.
    },
    async closeFxEditor(): Promise<void> {
      // No native FX editor in the browser.
    },
  };
}
