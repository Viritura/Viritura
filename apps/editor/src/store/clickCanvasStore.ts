import { useSyncExternalStore } from "react";
import type { WriteViewMode } from "@viritura/ui";
import type { PageSetup } from "@viritura/core";

export interface ClickCanvasConfig {
  readonly selectedScoreIndex: number;
  readonly selectedPartIds?: string[];
  readonly sourcePartIndex?: number;
  readonly viewMode: WriteViewMode;
  readonly pageSetup?: PageSetup;
  readonly fitToView?: boolean;
  readonly fitRequest?: number;
  readonly useWritten?: boolean;
  readonly onSelectMeasure?: (measureIndex: number) => void;
}

export interface ClickCanvasPlayback {
  readonly active: boolean;
  readonly position: { readonly measureIndex: number; readonly beat: number } | null;
}

const DEFAULT_CONFIG: ClickCanvasConfig = {
  selectedScoreIndex: 0,
  viewMode: "horizon",
};

const DEFAULT_PLAYBACK: ClickCanvasPlayback = { active: false, position: null };

let config = DEFAULT_CONFIG;
let playback = DEFAULT_PLAYBACK;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function publishClickCanvasConfig(next: ClickCanvasConfig): void {
  config = next;
  notify();
}

export function publishClickCanvasPlayback(next: ClickCanvasPlayback): void {
  playback = next;
  notify();
}

export function useClickCanvasConfig(): ClickCanvasConfig {
  return useSyncExternalStore(
    subscribe,
    () => config,
    () => config,
  );
}

export function useClickCanvasPlayback(): ClickCanvasPlayback {
  return useSyncExternalStore(
    subscribe,
    () => playback,
    () => playback,
  );
}

export function useClickCanvasActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => playback.active,
    () => playback.active,
  );
}
