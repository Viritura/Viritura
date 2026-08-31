import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Badge, Button, FormInput, IconButton, Text } from "@viritura/ui";
import { isSlotFullyConfigured, type ProfileSlot } from "@viritura/instrument-profiles";
import {
  putInstrumentProfileState,
  readInstrumentProfileState,
  removeInstrumentProfileSlot,
  renameInstrumentProfileSlot,
  updateInstrumentProfileSlotBinding,
} from "./instrumentProfileStore";
import { invalidateVstHostMirror } from "./vstTransport";
import type { ProfileHostBridge } from "./profileHostBridge";
import { SourcePickerDialog } from "./SourcePickerDialog";
import { FolderConfigDialog } from "./FolderConfigDialog";
import { useDiscoveredPlugins, useDiscoveredScripts } from "./useDiscovered";
import styles from "./instrumentProfiles.module.css";

interface SlotInspectorProps {
  profileId: string;
  slot: ProfileSlot | null;
  bridge: ProfileHostBridge;
}

function ValueText({ value }: { value: string | undefined }) {
  if (!value) return <span className={`${styles.configureValue} ${styles.configureValueUnset}`}>Not set</span>;
  return <span className={styles.configureValue}>{value}</span>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Editor for the selected instrument slot: its name, the three machine-local
 * bindings (Lua script, VST plugin, captured state), and removal.
 *
 * Mirrors the percussion editor's piece inspector — pick an instrument in the
 * list, edit it here — so the name is an ordinary text field rather than a
 * `window.prompt`, and destructive/toggling actions are icon buttons instead of
 * a row of text buttons repeated on every slot.
 *
 * Pickers and state capture go through the {@link ProfileHostBridge} so the same
 * UI works in the browser (path prompt, stubbed capture) and, on the desktop
 * host, drives the in-process VST3 host.
 */
export function SlotInspector({ profileId, slot, bridge }: SlotInspectorProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | "lua" | "vst">(null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const plugins = useDiscoveredPlugins();
  const scripts = useDiscoveredScripts();

  if (!slot) {
    return <div className={styles.inspectorEmpty}>Select an instrument to bind its script, plugin and state.</div>;
  }

  const { binding } = slot;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const setLua = (path: string) => {
    updateInstrumentProfileSlotBinding(profileId, slot.slotId, { luaScriptPath: path });
    setPicker(null);
  };

  const chooseLuaFile = () =>
    run(async () => {
      const path = await bridge.pickLuaScript();
      if (path) setLua(path);
    });

  const setPlugin = (path: string) =>
    run(async () => {
      const picked = await bridge.identifyPlugin(path);
      if (picked) {
        updateInstrumentProfileSlotBinding(profileId, slot.slotId, {
          pluginPath: picked.path,
          pluginIdentity: picked.identity,
        });
      }
      setPicker(null);
    });

  const choosePluginFile = () =>
    run(async () => {
      const picked = await bridge.pickPlugin();
      if (picked) {
        updateInstrumentProfileSlotBinding(profileId, slot.slotId, {
          pluginPath: picked.path,
          pluginIdentity: picked.identity,
        });
      }
      setPicker(null);
    });

  const captureState = () =>
    run(async () => {
      if (!binding.pluginPath) return;
      try {
        const existingState = await readInstrumentProfileState(binding);
        const bytes = await bridge.captureState({
          pluginPath: binding.pluginPath,
          ...(existingState ? { existingState } : {}),
        });
        if (bytes) {
          const stateRef = await putInstrumentProfileState(bytes);
          updateInstrumentProfileSlotBinding(profileId, slot.slotId, { stateRef });
        }
      } finally {
        // Opening the editor released the whole native host (release_if_running
        // tears down every slot + the audio device); forget the mirror so the
        // next play fully reloads rather than skipping unchanged slots and
        // playing them silent.
        invalidateVstHostMirror();
      }
    });

  return (
    <div className={styles.inspector}>
      <div className={styles.inspectorHeader}>
        <FormInput
          className={styles.inspectorName}
          value={slot.label}
          aria-label="Instrument name"
          onChange={(event) => renameInstrumentProfileSlot(profileId, slot.slotId, event.currentTarget.value)}
        />
        <IconButton
          size="sm"
          tooltip="Remove this instrument"
          onClick={() => removeInstrumentProfileSlot(profileId, slot.slotId)}
        >
          <Trash2 size={14} />
        </IconButton>
      </div>

      <div className={styles.inspectorStatus}>
        {isSlotFullyConfigured(binding) ? (
          <Badge variant="success">Ready</Badge>
        ) : (
          <Badge variant="muted">Incomplete</Badge>
        )}
      </div>

      <div className={styles.configureRow}>
        <span className={styles.configureLabel}>Lua script</span>
        <ValueText value={binding.luaScriptPath} />
        <Button label="Choose…" size="sm" onClick={() => setPicker("lua")} disabled={busy} />
      </div>

      <div className={styles.configureRow}>
        <span className={styles.configureLabel}>VST plugin</span>
        <ValueText value={binding.pluginPath} />
        <Button label="Choose…" size="sm" onClick={() => setPicker("vst")} disabled={busy} />
      </div>

      <div className={styles.configureRow}>
        <span className={styles.configureLabel}>VST state</span>
        <ValueText value={binding.stateRef ? `captured · ${binding.stateRef.slice(0, 12)}…` : undefined} />
        <Button
          label="Open plugin editor"
          size="sm"
          onClick={captureState}
          disabled={busy || !binding.pluginPath || !bridge.isDesktop}
          tooltip={!bridge.isDesktop ? "State capture requires the desktop app" : undefined}
        />
      </div>

      {error && (
        <Text variant="eyebrow" tone="error">
          {error}
        </Text>
      )}

      {!bridge.isDesktop && (
        <Text variant="eyebrow" tone="muted">
          Editing paths works everywhere; capturing plugin state requires the desktop app.
        </Text>
      )}

      <SourcePickerDialog
        open={picker === "lua"}
        title="Choose Lua script"
        entries={scripts.entries}
        loading={scripts.loading}
        currentPath={binding.luaScriptPath}
        emptyHint="No scripts found in the search folders."
        onPick={setLua}
        onBrowse={chooseLuaFile}
        onConfigureFolders={() => setFoldersOpen(true)}
        onClose={() => setPicker(null)}
      />
      <SourcePickerDialog
        open={picker === "vst"}
        title="Choose VST plugin"
        entries={plugins.entries}
        loading={plugins.loading}
        currentPath={binding.pluginPath}
        emptyHint="No plugins found in the search folders."
        onPick={(path) => void setPlugin(path)}
        onBrowse={choosePluginFile}
        onConfigureFolders={() => setFoldersOpen(true)}
        onClose={() => setPicker(null)}
      />
      <FolderConfigDialog open={foldersOpen} onClose={() => setFoldersOpen(false)} />
    </div>
  );
}
