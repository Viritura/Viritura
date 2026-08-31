/**
 * On-disk persistence for each FX-chain plugin's captured editor state.
 *
 * Every plugin slot in a chain can hold an edit-and-listen patch. Because a
 * channel can host several plugins, each entry's bytes live at a path keyed by
 * its channel and stable local id (see `FxPluginEntry.id`). Desktop-only: the
 * web build has no native host, so both calls no-op. The bytes are opaque VST3
 * component state produced by the native editor when the user closes it.
 */

import type { FxChannelId } from "./fxChainStore";
import { isDesktopHost } from "./profileHostBridge";

function statePath(channel: FxChannelId, id: string): string {
  return `fx-chains/${channel}/${id}.bin`;
}

/** Persist an FX plugin's captured state bytes. No-op off desktop. */
export async function writeFxPluginState(channel: FxChannelId, id: string, bytes: Uint8Array): Promise<void> {
  if (!isDesktopHost()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("profile_fs_write_binary", { path: statePath(channel, id), bytes: Array.from(bytes) });
}

/** Read a saved FX plugin state, or `null` when none exists. */
export async function readFxPluginState(channel: FxChannelId, id: string): Promise<Uint8Array | null> {
  if (!isDesktopHost()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke<number[] | null>("profile_fs_read_binary", { path: statePath(channel, id) });
  return bytes && bytes.length > 0 ? Uint8Array.from(bytes) : null;
}
