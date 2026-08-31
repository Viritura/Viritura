/**
 * Spatial-audio store — 2D positions for instruments and the listener.
 *
 * Replaces `SpatialContext` (reducer + dual Context API) with a single
 * zustand store. Action signatures match `SpatialActions` from the
 * original context, so consumers can migrate via two hook calls:
 *   - `useSpatialState(selector)` for state slices
 *   - `useSpatialActions()` (or module-level functions) for mutators
 *
 * Supports parent-child node grouping:
 * - Child nodes represent ensemble layer spatial positions (e.g. Ens 1).
 * - Part groups link duplicate instruments (e.g. Violin I + Violin II).
 * - Dragging a parent moves its children/group members by the same delta.
 * - Dragging a child or group member moves it independently.
 */

import { create } from "zustand";
import { useShallow } from "zustand/shallow";

// ─── Types ───────────────────────────────────────────────

interface SpatialPosition {
  x: number;
  y: number;
}

export type { SpatialPosition };

/** A virtual child node representing an ensemble layer's spatial position. */
export interface ChildSpatialNode {
  id: string;
  label: string;
  parentPartIndex: number;
  layerIndex: number;
  position: SpatialPosition;
  offset: SpatialPosition;
}

/** Groups duplicate instruments so they move together when dragging the parent. */
export interface PartGroup {
  parentIndex: number;
  memberIndices: number[];
}

export interface SpatialState {
  readonly positions: readonly SpatialPosition[];
  readonly listener: SpatialPosition;
  readonly enabled: boolean;
  readonly childNodes: readonly ChildSpatialNode[];
  readonly partGroups: readonly PartGroup[];
}

export interface SpatialActions {
  setPartPosition(partIndex: number, x: number, y: number): void;
  setListenerPosition(x: number, y: number): void;
  initPositions(partCount: number, getDefault: (index: number) => SpatialPosition): void;
  toggleEnabled(): void;
  setChildPosition(childId: string, x: number, y: number): void;
  initChildNodes(nodes: ChildSpatialNode[]): void;
  initPartGroups(groups: PartGroup[]): void;
}

// ─── Helpers ─────────────────────────────────────────────

/** Strip trailing Roman numerals or digits to get base instrument name. */
function baseInstrumentName(name: string): string {
  return name.replace(/\s*(I{1,3}V?|[1-4])\s*$/, "").trim();
}

/** Auto-detect part groups from instrument names (e.g. Violin I + Violin II). */
export function detectPartGroups(partNames: string[]): PartGroup[] {
  const groups: PartGroup[] = [];
  const assigned = new Set<number>();
  for (let i = 0; i < partNames.length; i++) {
    if (assigned.has(i)) continue;
    const base = baseInstrumentName(partNames[i]!);
    const members: number[] = [];
    for (let j = i + 1; j < partNames.length; j++) {
      if (assigned.has(j)) continue;
      if (baseInstrumentName(partNames[j]!) === base) {
        members.push(j);
        assigned.add(j);
      }
    }
    if (members.length > 0) {
      groups.push({ parentIndex: i, memberIndices: members });
      assigned.add(i);
    }
  }
  return groups;
}

// ─── Store ───────────────────────────────────────────────

type SpatialStore = SpatialState & SpatialActions;

const useSpatialStore = create<SpatialStore>()((set) => ({
  positions: [],
  listener: { x: 0, y: 1 },
  enabled: true,
  childNodes: [],
  partGroups: [],

  setPartPosition: (partIndex, x, y) =>
    set((state) => {
      if (partIndex < 0 || partIndex >= state.positions.length) return state;
      const positions = [...state.positions];
      const oldPos = positions[partIndex];
      positions[partIndex] = { x, y };

      const dx = oldPos ? x - oldPos.x : 0;
      const dy = oldPos ? y - oldPos.y : 0;

      // Move group members if this part is a group parent.
      const group = state.partGroups.find((g) => g.parentIndex === partIndex);
      if (group && oldPos) {
        for (const memberIdx of group.memberIndices) {
          const mp = positions[memberIdx];
          if (mp) positions[memberIdx] = { x: mp.x + dx, y: mp.y + dy };
        }
      }

      // Move child nodes belonging to this part (or group members).
      let childNodes = state.childNodes;
      if (oldPos && state.childNodes.length > 0) {
        const affectedParts = new Set([partIndex]);
        if (group) group.memberIndices.forEach((m) => affectedParts.add(m));
        childNodes = state.childNodes.map((cn) =>
          affectedParts.has(cn.parentPartIndex)
            ? { ...cn, position: { x: cn.position.x + dx, y: cn.position.y + dy } }
            : cn,
        );
      }

      return { positions, childNodes };
    }),

  setListenerPosition: (x, y) => set({ listener: { x, y } }),

  initPositions: (partCount, getDefault) => {
    const positions: SpatialPosition[] = [];
    for (let i = 0; i < partCount; i++) {
      positions.push(getDefault(i));
    }
    set({ positions, listener: { x: 0, y: 1 } });
  },

  toggleEnabled: () => set((state) => ({ enabled: !state.enabled })),

  setChildPosition: (childId, x, y) =>
    set((state) => {
      const childNodes = state.childNodes.map((cn) => {
        if (cn.id !== childId) return cn;
        const parentPos = state.positions[cn.parentPartIndex];
        return {
          ...cn,
          position: { x, y },
          offset: parentPos ? { x: x - parentPos.x, y: y - parentPos.y } : cn.offset,
        };
      });
      return { childNodes };
    }),

  initChildNodes: (nodes) => set({ childNodes: nodes }),
  initPartGroups: (groups) => set({ partGroups: groups }),
}));

// ─── Hooks ───────────────────────────────────────────────

/** Subscribe to the spatial state object (positions, listener, enabled, …). */
export function useSpatial(): SpatialState {
  return useSpatialStore(
    useShallow((s) => ({
      positions: s.positions,
      listener: s.listener,
      enabled: s.enabled,
      childNodes: s.childNodes,
      partGroups: s.partGroups,
    })),
  );
}

/** Stable bundle of action functions (zustand actions are referentially stable). */
export function useSpatialActions(): SpatialActions {
  return useSpatialStore(
    useShallow((s) => ({
      setPartPosition: s.setPartPosition,
      setListenerPosition: s.setListenerPosition,
      initPositions: s.initPositions,
      toggleEnabled: s.toggleEnabled,
      setChildPosition: s.setChildPosition,
      initChildNodes: s.initChildNodes,
      initPartGroups: s.initPartGroups,
    })),
  );
}

/**
 * Imperative read of the current spatial scene. Used to snapshot live
 * positions into the score on drag end (persistence) without subscribing a
 * component to every drag-move update.
 */
export function getSpatialSnapshot(): { positions: readonly SpatialPosition[]; listener: SpatialPosition } {
  const s = useSpatialStore.getState();
  return { positions: s.positions, listener: s.listener };
}
