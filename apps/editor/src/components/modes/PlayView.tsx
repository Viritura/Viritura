import { useCallback, useEffect, useEffectEvent } from "react";

import { TransportBar } from "@viritura/playback";
import { ToolbarPortal } from "../AppShell";
import { ViewLayout } from "../ViewLayout";
import { MixerPanel, type MixerPartInfo } from "../MixerPanel";
import { updatePartSoundSource, type PartSoundSourceChange } from "../mixerSoundPicker";
import { assignAllPartsToProfile } from "../../instrumentProfiles";
import type { VstInstrumentProfile } from "@viritura/instrument-profiles";
import { SpatialCanvas, type SpatialPartInfo } from "../SpatialCanvas";
import { useSpatial, useSpatialActions, detectPartGroups, getSpatialSnapshot } from "../../store/spatialStore";
import type { ChildSpatialNode } from "../../store/spatialStore";
import { useDocumentStoreApi } from "../../store/DocumentContext";
import { usePlaybackActions, PAN_RANGE } from "@viritura/playback";
import { getOrchestraPositions, gmProgramForInstrument, isStringSoloProgram } from "@viritura/audio";
import { resolvePartDisplayNames } from "@viritura/core";
import type { Score } from "@viritura/core";
import { partFamilyColor } from "../../score/familyColors";

interface PlayViewProps {
  /** The current score, if available. */
  score?: Score | null;
}

/**
 * Play mode — playback transport, mixer, and instrument configuration.
 */
export function PlayView({ score }: PlayViewProps) {
  const rawParts = score?.parts ?? [];
  const displayInfos = resolvePartDisplayNames(rawParts);
  const parts: MixerPartInfo[] = rawParts.map((p, i) => ({
    name: displayInfos[i]?.displayName ?? (p.name || `Part ${i + 1}`),
    index: i,
  }));

  // Mixer channel-count sync, family-group sync, and the mixer→engine bridge
  // live in the always-mounted <MixerSyncBridge> (see main.tsx) so mute/solo is
  // honored on Play from any view — not just while this page is on screen.
  return (
    <>
      <SpatialBridge parts={parts} score={score ?? null} />
      <PlayViewInner parts={parts} score={score} />
    </>
  );
}

function PlayViewInner({ parts, score }: { parts: MixerPartInfo[]; score?: Score | null | undefined }) {
  // Build spatial part infos with colors
  const spatialParts: SpatialPartInfo[] = parts.map((p) => ({
    name: p.name,
    index: p.index,
    color: partFamilyColor(p.name),
    icon: partFamilyIcon(p.name),
  }));

  const commitSpatial = useCommitSpatialPositions();
  const commitSoundSource = useCommitPartSoundSource();
  const commitAssignAll = useCommitAssignAllToProfile();

  return (
    <>
      <ToolbarPortal>
        <TransportBar />
      </ToolbarPortal>
      <ViewLayout
        layoutId="play-layout"
        leftPanel={{
          content: (
            <MixerPanel
              parts={parts}
              score={score}
              onSoundSourceChange={commitSoundSource}
              onAssignAllToProfile={commitAssignAll}
            />
          ),
          defaultSize: 280,
          minSize: 220,
          maxSize: 400,
        }}
      >
        <SpatialCanvas parts={spatialParts} onCommitPositions={commitSpatial} />
      </ViewLayout>
    </>
  );
}

function useCommitPartSoundSource(): (change: PartSoundSourceChange) => void {
  const store = useDocumentStoreApi();
  return useCallback(
    (change) => {
      const state = store.getState();
      const score = state.score;
      if (!score) return;
      state.updateScore(updatePartSoundSource(score, change));
    },
    [store],
  );
}

/** Commit a bulk "assign all parts to this VST profile" action to the document. */
function useCommitAssignAllToProfile(): (profile: VstInstrumentProfile) => void {
  const store = useDocumentStoreApi();
  return useCallback(
    (profile) => {
      const state = store.getState();
      const score = state.score;
      if (!score) return;
      state.updateScore(assignAllPartsToProfile(score, profile));
    },
    [store],
  );
}

/**
 * Returns a stable callback that snapshots the live spatial positions into the
 * score's parts (`_x.viritura.spatial`) and commits them via `updateScore`, so
 * a user's instrument arrangement persists in the document model and on disk.
 * No-op when nothing changed (e.g. a drag that ended where it began).
 */
function useCommitSpatialPositions(): () => void {
  const store = useDocumentStoreApi();
  return useCallback(() => {
    const state = store.getState();
    const score = state.score;
    if (!score) return;
    const { positions } = getSpatialSnapshot();
    let changed = false;
    const parts = score.parts.map((part, i) => {
      const pos = positions[i];
      if (!pos) return part;
      const prev = part._x?.viritura?.spatial;
      if (prev && prev.x === pos.x && prev.y === pos.y) return part;
      changed = true;
      return {
        ...part,
        _x: { ...part._x, viritura: { ...part._x?.viritura, spatial: { x: pos.x, y: pos.y } } },
      };
    });
    if (!changed) return;
    state.updateScore({ ...score, parts });
  }, [store]);
}

/**
 * Bridge that syncs SpatialContext positions to PannerNodes in the audio engine.
 * Also creates child nodes for ensemble layers and part groups for duplicate instruments.
 */
function SpatialBridge({ parts, score }: { parts: MixerPartInfo[]; score: Score | null }) {
  const spatial = useSpatial();
  const { initPositions, initChildNodes, initPartGroups } = useSpatialActions();
  const { applySpatialPosition, applySpatialListener, applyLayerPan } = usePlaybackActions();

  // Seed positions from each part's saved spatial position (persisted in the
  // MNX under `_x.viritura.spatial`) when present, else orchestral defaults.
  // Keyed on the part-roster signature (names) so it re-seeds only when parts
  // are added/removed/renamed — NOT on every score edit, which would clobber
  // an in-progress arrangement and reset the listener. Saved positions are
  // read through a ref so this stays out of the dependency array.
  const partNames = parts.map((p) => p.name);
  const partsSig = partNames.join("\u0000");
  const savedSpatialFor = useEffectEvent((i: number) => score?.parts[i]?._x?.viritura?.spatial);
  useEffect(() => {
    if (partNames.length === 0) return;
    const defaults = getOrchestraPositions(partNames);
    initPositions(partNames.length, (i) => savedSpatialFor(i) ?? defaults[i] ?? { x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only when the part roster (names/count) changes; saved positions are read via an effect event to avoid clobbering live drags on unrelated score edits
  }, [partsSig, initPositions]);

  // Create part groups for duplicate instruments
  useEffect(() => {
    if (parts.length === 0) return;
    const groups = detectPartGroups(parts.map((p) => p.name));
    initPartGroups(groups);
  }, [parts, initPartGroups]);

  // Create child nodes for ensemble layers. Derived synchronously from part
  // names so the children appear immediately on view mount — we don't need
  // to wait for the SF2 samplers to build (which happens on first play).
  // Source of truth must match createSamplersForScore: solo string parts
  // (GM 40–43) get layered with String Ensemble 1 + 2.
  useEffect(() => {
    if (parts.length === 0 || spatial.positions.length === 0) return;
    const childNodes: ChildSpatialNode[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const gm = gmProgramForInstrument(part.name);
      if (gm === null || !isStringSoloProgram(gm)) continue;
      const layerCount = 2;
      const parentPos = spatial.positions[i];
      if (!parentPos) continue;
      // Create child nodes in a triangle formation:
      //   Ens 1: directly behind parent (y+1)
      //   Ens 2: behind and outward (y+0.5, x±1.5 away from center)
      // Exception: double bass/contrabass — vertical stack only (y+1.5 apart)
      //   since they sit at the far edge of the string arc.
      const LAYER_LABELS = ["Ens 1", "Ens 2"];
      const nameLower = part.name.toLowerCase();
      const isEdgeString = /contrabass|double bass/i.test(nameLower);
      const outward = parentPos.x >= 0 ? 1.5 : -1.5;
      const LAYER_OFFSETS = isEdgeString
        ? [
            { x: 0, y: 1.5 },
            { x: 0, y: 3 },
          ] // vertical stack
        : [
            { x: 0, y: 1 },
            { x: outward, y: 0.5 },
          ]; // triangle
      for (let l = 0; l < layerCount; l++) {
        const offset = LAYER_OFFSETS[l] ?? { x: outward, y: 0.5 };
        childNodes.push({
          id: `${i}-ens${l}`,
          label: LAYER_LABELS[l] ?? `Ens ${l + 1}`,
          parentPartIndex: i,
          layerIndex: l,
          position: { x: parentPos.x + offset.x, y: parentPos.y + offset.y },
          offset,
        });
      }
    }
    initChildNodes(childNodes);
    // Re-run when parts change OR when positions first become available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, spatial.positions.length, initChildNodes]);

  // Sync part positions to audio PannerNodes
  useEffect(() => {
    for (let i = 0; i < spatial.positions.length; i++) {
      const pos = spatial.positions[i];
      if (pos) applySpatialPosition(i, pos.x, pos.y);
    }
    applySpatialListener(spatial.listener.x, spatial.listener.y);
  }, [spatial.positions, spatial.listener, applySpatialPosition, applySpatialListener]);

  // Sync child node positions to listener-relative layer panning
  useEffect(() => {
    const lx = spatial.listener.x;
    for (const cn of spatial.childNodes) {
      // Each child node's pan is computed from its own 2D position relative to listener
      const layerPan = Math.max(-1, Math.min(1, (cn.position.x - lx) / PAN_RANGE));
      applyLayerPan(cn.parentPartIndex, cn.layerIndex, layerPan);
    }
  }, [spatial.childNodes, spatial.positions, spatial.listener, applyLayerPan]);

  return null;
}

/** Emoji icon per instrument family. */
const FAMILY_ICON_MAP: [RegExp, string][] = [
  [/violin|viola|cello|contrabass(?!oon)|double bass/i, "🎻"],
  [/harp/i, "🎵"],
  [/flute|piccolo|oboe|clarinet|bassoon|english horn|contrabassoon/i, "🪈"],
  [/trumpet|trombone|horn|tuba/i, "🎺"],
  [/timpani|percussion|glockenspiel|xylophone|marimba|vibraphone|tubular|cymbal|drum/i, "🥁"],
  [/piano|celesta|organ|keyboard|harpsichord/i, "🎹"],
  [/choir|soprano|alto|tenor|baritone|bass voice|vocal|^bass$/i, "🎤"],
];

function partFamilyIcon(name: string): string {
  for (const [pattern, icon] of FAMILY_ICON_MAP) {
    if (pattern.test(name)) return icon;
  }
  return "🎵";
}

// ═══════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════
