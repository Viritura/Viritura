/**
 * FX Chains page — a full-screen dialog for building the ordered VST insert list
 * on a mixer channel (v1: the shared reverb aux and the master bus).
 *
 * Kept deliberately off the mixer strip (which stays uncluttered): an "Fx" button
 * on the reverb group / master strip opens this page for that channel. The page
 * lists the channel's plugins in processing order with add / remove / reorder,
 * and — Reaper-style — a single plugin's native editor at a time, opened in a
 * modeless floating window via {@link ProfileHostBridge.showFxEditor}. The
 * channel's chain is pushed to the host before the editor opens so it can be
 * tweaked without first pressing play. Desktop-only; the web build has no host.
 */

import { useCallback, useEffect, useState } from "react";
import { X, Plus, ArrowUp, ArrowDown, Trash2, SlidersHorizontal } from "lucide-react";
import { Button, ButtonGroup, Dialog, DialogHeader, IconButton, Slider, withTooltip } from "@viritura/ui";
import { useFxChainDialogStore } from "./fxChainDialogStore";
import { useFxChainStore, readFxChains, type FxChannelId } from "./fxChainStore";
import { writeFxPluginState } from "./fxChainState";
import { ensureFxChainLoaded } from "./vstTransport";
import { selectHostBridge, isDesktopHost } from "./profileHostBridge";
import { useDefaultReverbStore } from "./defaultReverbStore";
import { useDiscoveredPlugins } from "./useDiscovered";
import { SourcePickerDialog } from "./SourcePickerDialog";
import { FolderConfigDialog } from "./FolderConfigDialog";
import styles from "./fxChain.module.css";

const CHANNEL_OPTIONS: { value: FxChannelId; label: string }[] = [
  { value: "reverb", label: "Reverb" },
  { value: "master", label: "Master" },
];

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/**
 * Persist an FX plugin's edited state when the user closes its modeless editor.
 * The host thread emits `vst-fx-editor-closed` with the captured bytes tagged by
 * channel + chain index; we map that back to the entry and bump its state
 * version so the next play reloads the chain with the new patch. Mounted once
 * (independent of whether the page is open) so a close is never missed.
 */
function useFxEditorClosedListener(): void {
  useEffect(() => {
    if (!isDesktopHost()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const un = await listen<{ channel: string; index: number; state: number[] }>("vst-fx-editor-closed", (event) => {
        const { channel, index, state } = event.payload;
        const bytes = Uint8Array.from(state);
        if (bytes.length === 0) return;
        const chan = channel as FxChannelId;
        const entry = readFxChains()[chan]?.plugins[index];
        if (!entry) return;
        void (async () => {
          await writeFxPluginState(chan, entry.id, bytes);
          useFxChainStore.getState().markStateCaptured(chan, entry.id);
        })();
      });
      if (cancelled) un();
      else unlisten = un;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

/** The reverb channel's global send + wet return levels. */
function ReverbLevels() {
  const send = useFxChainStore((s) => s.config.reverb.send);
  const wet = useFxChainStore((s) => s.config.reverb.wet);
  const setSend = useFxChainStore((s) => s.setSend);
  const setWet = useFxChainStore((s) => s.setWet);
  return (
    <div className={styles.levels}>
      <div className={styles.levelRow}>
        <span className={styles.levelLabel}>Send</span>
        <Slider value={send} min={0} max={1} step={0.01} onChange={setSend} ariaLabel="Reverb send" />
        <span className={styles.levelReadout}>{Math.round(send * 100)}</span>
      </div>
      <div className={styles.levelRow}>
        <span className={styles.levelLabel}>Wet</span>
        <Slider value={wet} min={0} max={1} step={0.01} onChange={setWet} ariaLabel="Reverb wet" />
        <span className={styles.levelReadout}>{Math.round(wet * 100)}</span>
      </div>
    </div>
  );
}

interface ChainListProps {
  channel: FxChannelId;
}

/** The ordered plugin list for one channel, with reorder / editor / remove. */
function ChainList({ channel }: ChainListProps) {
  const plugins = useFxChainStore((s) => s.config[channel].plugins);
  const removePlugin = useFxChainStore((s) => s.removePlugin);
  const movePlugin = useFxChainStore((s) => s.movePlugin);
  const [busyId, setBusyId] = useState<string | null>(null);

  const showEditor = useCallback(
    async (index: number, id: string) => {
      setBusyId(id);
      try {
        await ensureFxChainLoaded(channel);
        await selectHostBridge().showFxEditor({ channel, index });
      } catch (error) {
        console.warn("[fx] failed to open plugin editor:", error);
      } finally {
        setBusyId(null);
      }
    },
    [channel],
  );

  if (plugins.length === 0) {
    return <div className={styles.empty}>No effects yet. Add one below to build this channel&rsquo;s chain.</div>;
  }

  return (
    <div className={styles.list}>
      {plugins.map((entry, index) => (
        <div key={entry.id} className={`${styles.row} ${busyId === entry.id ? styles.rowSelected : ""}`}>
          <span className={styles.rowIndex}>{index + 1}</span>
          {withTooltip(<span className={styles.rowName}>{entry.pluginName}</span>, entry.pluginPath)}
          <div className={styles.rowActions}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void showEditor(index, entry.id)}
              disabled={busyId !== null}
            >
              Edit
            </Button>
            <IconButton
              size="sm"
              tooltip="Move earlier"
              disabled={index === 0}
              onClick={() => movePlugin(channel, entry.id, -1)}
            >
              <ArrowUp size={14} />
            </IconButton>
            <IconButton
              size="sm"
              tooltip="Move later"
              disabled={index === plugins.length - 1}
              onClick={() => movePlugin(channel, entry.id, 1)}
            >
              <ArrowDown size={14} />
            </IconButton>
            <IconButton size="sm" tooltip="Remove" onClick={() => removePlugin(channel, entry.id)}>
              <Trash2 size={14} />
            </IconButton>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The FX Chains page. Rendered once near the app root; opens when the shared
 * dialog store is pointed at a channel and closes to `null`.
 */
export function FxChainDialog() {
  const channel = useFxChainDialogStore((s) => s.channel);
  const openFxChain = useFxChainDialogStore((s) => s.openFxChain);
  const closeFxChain = useFxChainDialogStore((s) => s.closeFxChain);
  const addPlugin = useFxChainStore((s) => s.addPlugin);
  const ensureReverbSeeded = useFxChainStore((s) => s.ensureReverbSeeded);
  const defaultReverbName = useDefaultReverbStore((s) => s.pluginName);
  const discovered = useDiscoveredPlugins();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(false);

  useFxEditorClosedListener();

  // Seed the reverb chain from the configured default the moment the page opens
  // on the reverb channel, so an untouched chain shows the sensible default.
  useEffect(() => {
    if (channel === "reverb") ensureReverbSeeded();
  }, [channel, ensureReverbSeeded]);

  const browseForPlugin = useCallback(async () => {
    if (!channel) return;
    setPickerOpen(false);
    const picked = await selectHostBridge().pickPlugin();
    if (picked) addPlugin(channel, picked.path, fileNameOf(picked.path));
  }, [channel, addPlugin]);

  const pickDiscovered = useCallback(
    (path: string) => {
      if (!channel) return;
      addPlugin(channel, path, fileNameOf(path));
      setPickerOpen(false);
    },
    [channel, addPlugin],
  );

  if (!channel) return null;

  return (
    <Dialog open onClose={closeFxChain} size="wide">
      <DialogHeader title="FX Chains" onClose={closeFxChain} closeIcon={<X size={14} />}>
        <SlidersHorizontal size={14} />
      </DialogHeader>
      <div className={styles.body}>
        <div className={styles.tabs}>
          <ButtonGroup options={CHANNEL_OPTIONS} value={channel} onChange={openFxChain} />
        </div>

        {channel === "reverb" ? <ReverbLevels /> : null}

        <ChainList channel={channel} />

        <div className={styles.footer}>
          <span className={styles.hint}>
            {channel === "reverb" && defaultReverbName
              ? `Default reverb: ${defaultReverbName}`
              : "Effects process top to bottom."}
          </span>
          <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
            <Plus size={14} /> Add effect
          </Button>
        </div>
      </div>

      <SourcePickerDialog
        open={pickerOpen}
        title="Add effect plugin"
        entries={discovered.entries}
        loading={discovered.loading}
        emptyHint="No plugins found in your search folders. Use Browse to pick a file, or add folders."
        onPick={pickDiscovered}
        onBrowse={() => void browseForPlugin()}
        onConfigureFolders={() => {
          setPickerOpen(false);
          setFoldersOpen(true);
        }}
        onClose={() => setPickerOpen(false)}
      />
      <FolderConfigDialog open={foldersOpen} onClose={() => setFoldersOpen(false)} />
    </Dialog>
  );
}
