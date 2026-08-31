/**
 * MixerSyncBridge — always-mounted bridge that pushes the module-level mixer
 * store state into the audio engine, regardless of which view is active.
 *
 * Previously the mixer→engine sync lived inside PlayView and therefore only ran
 * while the Mixer/Play view was mounted. That meant mute/solo/volume changes
 * were ignored when playback was started from any other view until the user
 * revisited the mixer page (which re-ran the effect). Mounting this bridge at
 * the app root keeps the engine's per-part mixer state (and the native VST
 * host's muted-part set) continuously in sync, so mute/solo is honored on Play
 * from anywhere.
 *
 * The purely spatial bridges (listener/stage positions, ensemble child nodes)
 * stay in PlayView because they are only meaningful while the spatial stage UI
 * is on screen.
 */

import { useEffect, useMemo, useRef } from "react";
import type { Score } from "@viritura/core";
import { resolvePartDisplayNames } from "@viritura/core";
import { virituraSoundsProfile } from "@viritura/sound-profiles";
import { usePlaybackActions, usePlaybackState } from "@viritura/playback";
import { useMixer, useMixerActions, useMixerPartSync } from "../store/mixerStore";
import { extractFamilyGroups, buildPartGroups } from "../store/familyGroups";
import { useDocumentStoreApi } from "../store/DocumentContext";
import { useAudioRenderModeStore } from "../instrumentProfiles";
import { revertVstAssignmentsToNotationDefault } from "./mixerSoundPicker";
import type { MixerPartInfo } from "./MixerPanel";

interface MixerSyncBridgeProps {
  score?: Score | null;
}

/** Derive the mixer's ordered part roster from a score. */
function partsFromScore(score: Score | null | undefined): MixerPartInfo[] {
  const rawParts = score?.parts ?? [];
  const displayInfos = resolvePartDisplayNames(rawParts);
  return rawParts.map((p, i) => ({
    name: displayInfos[i]?.displayName ?? (p.name || `Part ${i + 1}`),
    index: i,
  }));
}

export function MixerSyncBridge({ score }: MixerSyncBridgeProps) {
  const parts = useMemo(() => partsFromScore(score), [score]);
  useMixerPartSync(parts.length);
  return (
    <>
      <MixerGroupSync parts={parts} score={score ?? null} />
      <MixerEngineBridge partCount={parts.length} />
      <AudioRenderModeRevertBridge />
    </>
  );
}

/**
 * Reacts to desktop audio-render-mode changes. On ANY mode switch it first stops
 * playback: the web and native paths own different audio graphs (browser
 * SoundFont vs the native VST mixer stream) and different part→voice ownership,
 * so switching mid-playback would otherwise leave the previous path's stream
 * running while `vstOwnedParts` filtering no longer matches — heard as stale,
 * doubled, or silent audio (review comment 1). Stopping releases the native
 * transport and forces the next play to re-prepare cleanly for the new mode.
 *
 * Additionally, on a native→web transition it resets every part assigned to a
 * user VST profile back to its notation VirituraSounds default: VST assignments
 * only play through the native mixer, so carrying them into web mode would leave
 * the Mixer showing unplayable sources. Both fire only on a real transition
 * (never on initial mount).
 */
function AudioRenderModeRevertBridge() {
  const mode = useAudioRenderModeStore((s) => s.mode);
  const store = useDocumentStoreApi();
  const { stop } = usePlaybackActions();
  const status = usePlaybackState().status;
  const prevModeRef = useRef(mode);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (prev === mode) return;

    // Stop the outgoing path so its stream/ownership can't linger into the new
    // mode. Safe no-op when already stopped.
    if (status !== "stopped") stop();

    if (prev !== "native" || mode !== "web") return;
    const state = store.getState();
    const score = state.score;
    if (!score) return;
    const reverted = revertVstAssignmentsToNotationDefault(
      score,
      virituraSoundsProfile.id,
      virituraSoundsProfile.version,
    );
    if (reverted !== score) state.updateScore(reverted);
  }, [mode, status, store, stop]);
  return null;
}

/**
 * Keeps mixer group bus state in sync with the score layout's family
 * groups (e.g. Woodwinds, Brass).
 */
function MixerGroupSync({ parts, score }: { parts: MixerPartInfo[]; score: Score | null }) {
  const { syncGroups } = useMixerActions();
  useEffect(() => {
    const groups = extractFamilyGroups(score, parts);
    const groupIds = groups.map((g) => g.label);
    const partGroups = buildPartGroups(parts.length, groups);
    syncGroups(groupIds, partGroups);
  }, [score, parts, syncGroups]);
  return null;
}

/**
 * Bridge that syncs MixerContext state changes to the audio engine's samplers
 * and the native VST host.
 *
 * Applies DAW-style multiplicative group bus:
 *   effectiveVolume = channel.volume × group.volume × master.volume
 *   effectivelyMuted = channel.muted || group.muted || masterMuted
 *                   || (anyChannelSolo && !channel.solo)
 *                   || (anyGroupSolo   && !group.solo)
 */
function MixerEngineBridge({ partCount }: { partCount: number }) {
  const mixer = useMixer();
  const { applyMix, setEnsembleLayer, setVstMutedParts } = usePlaybackActions();
  const anyChannelSolo = mixer.channels.some((ch) => ch.solo);
  let anyGroupSolo = false;
  for (const id in mixer.groups) {
    if (mixer.groups[id]!.solo) {
      anyGroupSolo = true;
      break;
    }
  }

  useEffect(() => {
    const mutedParts = new Set<number>();
    for (let i = 0; i < partCount; i++) {
      const ch = mixer.channels[i];
      if (!ch) continue;
      const groupId = mixer.partGroups[i] ?? "";
      const group = groupId ? mixer.groups[groupId] : undefined;
      const groupVolume = group?.volume ?? 1;
      const groupMuted = group?.muted ?? false;
      const groupSolo = group?.solo ?? false;

      const effectivelyMuted =
        ch.muted || groupMuted || mixer.masterMuted || (anyChannelSolo && !ch.solo) || (anyGroupSolo && !groupSolo);
      const effectiveVolume = ch.volume * groupVolume * mixer.masterVolume;
      applyMix(i, effectiveVolume, ch.pan, effectivelyMuted, ch.spatialMode === "stage");
      setEnsembleLayer(i, ch.ensembleEnabled);
      if (effectivelyMuted) mutedParts.add(i);
    }
    // Mirror the resolved mute set to the native VST host (no-op on the web
    // build), so mute/solo silences VST-hosted parts just like SF2 parts.
    setVstMutedParts(mutedParts);
  }, [mixer, partCount, anyChannelSolo, anyGroupSolo, applyMix, setEnsembleLayer, setVstMutedParts]);

  return null;
}
