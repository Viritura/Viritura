import { useEffect } from "react";
import { CHORDS_PART_ID, patch, type Score, type ScoreMixerSettings } from "@viritura/core";
import type { DocumentStore } from "./documentStore";
import { useDocumentStoreApi } from "./DocumentContext";
import { buildPartGroups } from "./familyGroups";
import { scoreMixerGroups } from "./mixerRoster";
import { initialMixerState, mixerReducer, restoreMixerState, subscribeMixerEdits, type MixerState } from "./mixerStore";

function hasChords(score: Score): boolean {
  return score.global.measures.some((measure) => (measure.chordSymbols?.length ?? 0) > 0);
}

function restoreScoreMixer(score: Score | null): void {
  let state = initialMixerState();
  if (!score) {
    restoreMixerState(state);
    return;
  }
  // Create the derived default even while hidden, so its saved intent survives
  // deleting all chord symbols and adding them again.
  state = mixerReducer(state, { type: "SYNC_PARTS", partCount: score.parts.length, hasChords: true });
  const saved = score.mixer;
  const chords = { ...state.channels[score.parts.length]!, ...saved?.channels?.[CHORDS_PART_ID] };
  const groups = scoreMixerGroups(score);
  const visible = hasChords(score);
  restoreMixerState({
    ...state,
    channels: [
      ...score.parts.map((part, index) => ({
        ...state.channels[index]!,
        ...(part.id ? saved?.channels?.[part.id] : undefined),
      })),
      ...(visible ? [chords] : []),
    ],
    chordsPartIndex: visible ? score.parts.length : undefined,
    derivedChannels: { [CHORDS_PART_ID]: chords },
    groups: Object.fromEntries(
      groups.map(({ label }) => [
        label,
        {
          volume: 1,
          muted: false,
          solo: false,
          ...saved?.groups?.[label],
        },
      ]),
    ),
    partGroups: buildPartGroups(score.parts.length + Number(visible), groups),
    masterVolume: saved?.masterVolume ?? 1,
    masterMuted: saved?.masterMuted ?? false,
  });
}

function savedMixer(score: Score, state: MixerState): ScoreMixerSettings {
  const channels = Object.fromEntries(
    score.parts.flatMap((part, index) => {
      const channel = state.channels[index];
      return part.id && channel ? [[part.id, { ...channel }]] : [];
    }),
  );
  const chords = state.derivedChannels?.[CHORDS_PART_ID];
  if (chords) channels[CHORDS_PART_ID] = { ...chords };
  return {
    channels,
    groups: Object.fromEntries(Object.entries(state.groups).map(([id, group]) => [id, { ...group }])),
    masterVolume: state.masterVolume,
    masterMuted: state.masterMuted,
  };
}

/** Synchronous writes ensure a Save immediately after a mixer edit includes it. */
export function bindMixerDocument(store: DocumentStore): () => void {
  let generation = -1;
  let mixer: ScoreMixerSettings | undefined;
  let roster = "";
  function syncDocument(): void {
    const document = store.getState();
    const score = document.workingScore;
    const nextRoster = score ? JSON.stringify([score.parts.map((part) => [part.id, part.name]), hasChords(score)]) : "";
    if (generation === document.documentGeneration && mixer === score?.mixer && roster === nextRoster) return;
    generation = document.documentGeneration;
    mixer = score?.mixer;
    roster = nextRoster;
    restoreScoreMixer(score);
  }
  syncDocument();
  const unsubscribeDocument = store.subscribe(syncDocument);
  const unsubscribeMixer = subscribeMixerEdits((state) => {
    const score = store.getState().workingScore;
    if (!score) return;
    const next = savedMixer(score, state);
    if (JSON.stringify(next) === JSON.stringify(score.mixer)) return;
    store.getState().commitPatches([patch.setScoreExtension({ field: "mixer", value: next })]);
  });
  return () => {
    unsubscribeDocument();
    unsubscribeMixer();
  };
}

export function useMixerDocumentSync(): void {
  const store = useDocumentStoreApi();
  useEffect(() => bindMixerDocument(store), [store]);
}
