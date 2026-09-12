import { useCallback } from "react";
import type { ChordSymbolStyle } from "@viritura/core";
import { FormField, Select } from "@viritura/ui";
import { useDocumentStore, useDocumentStoreApi } from "../../../../../store/DocumentContext";
import {
  CHORD_SYMBOL_PRESETS,
  chordSymbolPresetFor,
  chordSymbolSettings,
  compactChordSymbolStyle,
} from "./chordSymbolStyleModel";

const ROOT_CASE_OPTIONS = [
  { value: "uppercase", label: "Uppercase roots" },
  { value: "lowercaseMinor", label: "Lowercase minor roots" },
];
const MAJOR_OPTIONS = [
  { value: "triangle", label: "Triangle" },
  { value: "maj", label: "maj" },
  { value: "M", label: "M" },
];
const MINOR_OPTIONS = [
  { value: "m", label: "m" },
  { value: "min", label: "min" },
  { value: "minus", label: "Minus symbol" },
  { value: "none", label: "No suffix" },
];
const DIMINISHED_OPTIONS = [
  { value: "symbol", label: "Circle symbol" },
  { value: "dim", label: "dim" },
];
const HALF_DIMINISHED_OPTIONS = [
  { value: "symbol", label: "Slashed-circle symbol" },
  { value: "minorFlatFive", label: "m7 flat 5" },
];
const AUGMENTED_OPTIONS = [
  { value: "plus", label: "Plus symbol" },
  { value: "aug", label: "aug" },
];
const EXTENSION_OPTIONS = [
  { value: "superscript", label: "Superscript" },
  { value: "baseline", label: "Baseline" },
];

export function ChordSymbolsPanel() {
  const score = useDocumentStore((state) => state.score);
  const store = useDocumentStoreApi();
  const settings = chordSymbolSettings(score?.chordSymbolStyle);
  const preset = chordSymbolPresetFor(settings);

  const commit = useCallback(
    (next: Required<ChordSymbolStyle>) => {
      const current = store.getState().workingScore;
      if (!current) return;
      const compact = compactChordSymbolStyle(next);
      store.getState().updateScore({
        ...current,
        chordSymbolStyle: Object.keys(compact).length > 0 ? compact : undefined,
      });
    },
    [store],
  );

  const setField = <K extends keyof Required<ChordSymbolStyle>>(field: K, value: Required<ChordSymbolStyle>[K]) => {
    const current = store.getState().workingScore;
    if (!current) return;
    commit({ ...chordSymbolSettings(current.chordSymbolStyle), [field]: value });
  };

  if (!score) return null;

  return (
    <>
      <FormField label="Preset">
        <Select
          aria-label="Chord symbol preset"
          value={preset}
          options={[
            ...CHORD_SYMBOL_PRESETS.map(({ id, label }) => ({ value: id, label })),
            { value: "custom", label: "Custom", disabled: true },
          ]}
          onValueChange={(value) => {
            const selected = CHORD_SYMBOL_PRESETS.find((candidate) => candidate.id === value);
            if (selected) commit(selected.settings);
          }}
        />
      </FormField>
      <FormField label="Root letters">
        <Select
          aria-label="Chord root letter case"
          value={settings.rootCase}
          options={ROOT_CASE_OPTIONS}
          onValueChange={(value) => setField("rootCase", value as Required<ChordSymbolStyle>["rootCase"])}
        />
      </FormField>
      <FormField label="Major seventh">
        <Select
          aria-label="Major seventh style"
          value={settings.majorSeventh}
          options={MAJOR_OPTIONS}
          onValueChange={(value) => setField("majorSeventh", value as Required<ChordSymbolStyle>["majorSeventh"])}
        />
      </FormField>
      <FormField label="Minor">
        <Select
          aria-label="Minor chord style"
          value={settings.minor}
          options={MINOR_OPTIONS}
          onValueChange={(value) => setField("minor", value as Required<ChordSymbolStyle>["minor"])}
        />
      </FormField>
      <FormField label="Diminished">
        <Select
          aria-label="Diminished chord style"
          value={settings.diminished}
          options={DIMINISHED_OPTIONS}
          onValueChange={(value) => setField("diminished", value as Required<ChordSymbolStyle>["diminished"])}
        />
      </FormField>
      <FormField label="Half-diminished">
        <Select
          aria-label="Half-diminished chord style"
          value={settings.halfDiminished}
          options={HALF_DIMINISHED_OPTIONS}
          onValueChange={(value) => setField("halfDiminished", value as Required<ChordSymbolStyle>["halfDiminished"])}
        />
      </FormField>
      <FormField label="Augmented">
        <Select
          aria-label="Augmented chord style"
          value={settings.augmented}
          options={AUGMENTED_OPTIONS}
          onValueChange={(value) => setField("augmented", value as Required<ChordSymbolStyle>["augmented"])}
        />
      </FormField>
      <FormField label="Extensions">
        <Select
          aria-label="Chord extension position"
          value={settings.extensions}
          options={EXTENSION_OPTIONS}
          onValueChange={(value) => setField("extensions", value as Required<ChordSymbolStyle>["extensions"])}
        />
      </FormField>
    </>
  );
}
