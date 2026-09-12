import { useCallback, type ReactNode } from "react";
import type { ChordSymbolStyle } from "@viritura/core";
import { Collapsible, PaletteButton } from "@viritura/ui";
import { useDocumentStore, useDocumentStoreApi } from "../../../../../store/DocumentContext";
import {
  CHORD_SYMBOL_PRESETS,
  chordSymbolPresetFor,
  chordSymbolSettings,
  compactChordSymbolStyle,
} from "./chordSymbolStyleModel";
import styles from "./ChordSymbolsPanel.module.css";

const GLYPH = {
  flat: "\uED60",
  augmented: "\uE872",
  diminished: "\uE870",
  halfDiminished: "\uE871",
  majorSeventh: "\uE873",
  minor: "\uE874",
} as const;

interface Choice<T extends string> {
  value: T;
  label: string;
  preview: ReactNode;
}

function Glyph({ children }: { children: ReactNode }) {
  return <span className={styles.bravura}>{children}</span>;
}

function Extension({ children, superscript = true }: { children: ReactNode; superscript?: boolean }) {
  return <span className={superscript ? styles.superscript : undefined}>{children}</span>;
}

function ChoiceGrid<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.choiceSection}>
      <span className={styles.choiceLabel}>{label}</span>
      <div className={styles.choiceGrid} role="radiogroup" aria-label={label}>
        {choices.map((choice) => (
          <PaletteButton
            key={choice.value}
            shape="vertical"
            selectionMode="radio"
            active={value === choice.value}
            title={choice.label}
            onClick={() => onChange(choice.value)}
            className={styles.choiceButton}
          >
            <span className={styles.choiceContent}>
              <span className={styles.choiceSpecimen}>{choice.preview}</span>
              <span className={styles.choiceButtonLabel}>{choice.label}</span>
            </span>
          </PaletteButton>
        ))}
      </div>
    </div>
  );
}

function PresetPreview({ style }: { style: Required<ChordSymbolStyle> }) {
  const root = style.rootCase === "lowercaseMinor" ? "d" : "D";
  const minor = style.minor === "minus" ? <Glyph>{GLYPH.minor}</Glyph> : style.minor === "none" ? "" : style.minor;
  const major = style.majorSeventh === "triangle" ? <Glyph>{GLYPH.majorSeventh}</Glyph> : style.majorSeventh;
  const extension = (value: string) => <Extension superscript={style.extensions === "superscript"}>{value}</Extension>;
  return (
    <span className={styles.presetSpecimens}>
      <span>
        C{major}
        {extension("7")}
      </span>
      <span>
        {root}
        {minor}
        {extension("7")}
      </span>
      <span>
        E<Glyph>{GLYPH.halfDiminished}</Glyph>
        {extension("7")}
      </span>
    </span>
  );
}

const ROOT_CASE_CHOICES: readonly Choice<Required<ChordSymbolStyle>["rootCase"]>[] = [
  { value: "uppercase", label: "Uppercase", preview: <span>C · Dm</span> },
  { value: "lowercaseMinor", label: "Minor lowercase", preview: <span>C · dm</span> },
];
const MAJOR_CHOICES: readonly Choice<Required<ChordSymbolStyle>["majorSeventh"]>[] = [
  {
    value: "triangle",
    label: "Triangle",
    preview: (
      <span>
        C<Glyph>{GLYPH.majorSeventh}</Glyph>
        <Extension>7</Extension>
      </span>
    ),
  },
  {
    value: "maj",
    label: "maj",
    preview: (
      <span>
        Cmaj<Extension>7</Extension>
      </span>
    ),
  },
  {
    value: "M",
    label: "M",
    preview: (
      <span>
        CM<Extension>7</Extension>
      </span>
    ),
  },
];
const MINOR_CHOICES: readonly Choice<Required<ChordSymbolStyle>["minor"]>[] = [
  {
    value: "m",
    label: "m",
    preview: (
      <span>
        Dm<Extension>7</Extension>
      </span>
    ),
  },
  {
    value: "min",
    label: "min",
    preview: (
      <span>
        Dmin<Extension>7</Extension>
      </span>
    ),
  },
  {
    value: "minus",
    label: "Minus",
    preview: (
      <span>
        D<Glyph>{GLYPH.minor}</Glyph>
        <Extension>7</Extension>
      </span>
    ),
  },
  {
    value: "none",
    label: "No suffix",
    preview: (
      <span>
        d<Extension>7</Extension>
      </span>
    ),
  },
];
const DIMINISHED_CHOICES: readonly Choice<Required<ChordSymbolStyle>["diminished"]>[] = [
  {
    value: "symbol",
    label: "Circle",
    preview: (
      <span>
        D<Glyph>{GLYPH.diminished}</Glyph>
        <Extension>7</Extension>
      </span>
    ),
  },
  {
    value: "dim",
    label: "dim",
    preview: (
      <span>
        Ddim<Extension>7</Extension>
      </span>
    ),
  },
];
const HALF_DIMINISHED_CHOICES: readonly Choice<Required<ChordSymbolStyle>["halfDiminished"]>[] = [
  {
    value: "symbol",
    label: "Slashed circle",
    preview: (
      <span>
        E<Glyph>{GLYPH.halfDiminished}</Glyph>
        <Extension>7</Extension>
      </span>
    ),
  },
  {
    value: "minorFlatFive",
    label: "Minor flat 5",
    preview: (
      <span>
        Em
        <Extension>
          7<Glyph>{GLYPH.flat}</Glyph>5
        </Extension>
      </span>
    ),
  },
];
const AUGMENTED_CHOICES: readonly Choice<Required<ChordSymbolStyle>["augmented"]>[] = [
  {
    value: "plus",
    label: "Plus",
    preview: (
      <span>
        C<Glyph>{GLYPH.augmented}</Glyph>
        <Extension>7</Extension>
      </span>
    ),
  },
  {
    value: "aug",
    label: "aug",
    preview: (
      <span>
        Caug<Extension>7</Extension>
      </span>
    ),
  },
];
const EXTENSION_CHOICES: readonly Choice<Required<ChordSymbolStyle>["extensions"]>[] = [
  {
    value: "superscript",
    label: "Superscript",
    preview: (
      <span>
        C<Extension>7</Extension>
      </span>
    ),
  },
  {
    value: "baseline",
    label: "Baseline",
    preview: (
      <span>
        C<Extension superscript={false}>7</Extension>
      </span>
    ),
  },
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
    <div className={styles.root}>
      <p className={styles.previewHint}>Changes engrave live on the score.</p>
      <div className={styles.presetGrid} role="radiogroup" aria-label="Chord symbol preset">
        {CHORD_SYMBOL_PRESETS.map((presetOption) => (
          <PaletteButton
            key={presetOption.id}
            shape="vertical"
            selectionMode="radio"
            active={preset === presetOption.id}
            title={presetOption.label}
            onClick={() => commit(presetOption.settings)}
            className={styles.presetButton}
          >
            <span className={styles.presetContent}>
              <PresetPreview style={presetOption.settings} />
              <span className={styles.presetLabel}>{presetOption.label}</span>
            </span>
          </PaletteButton>
        ))}
      </div>

      <Collapsible title="Advanced" className={styles.advanced}>
        <div className={styles.advancedFields}>
          <ChoiceGrid
            label="Root letters"
            value={settings.rootCase}
            choices={ROOT_CASE_CHOICES}
            onChange={(value) => setField("rootCase", value)}
          />
          <ChoiceGrid
            label="Major seventh"
            value={settings.majorSeventh}
            choices={MAJOR_CHOICES}
            onChange={(value) => setField("majorSeventh", value)}
          />
          <ChoiceGrid
            label="Minor"
            value={settings.minor}
            choices={MINOR_CHOICES}
            onChange={(value) => setField("minor", value)}
          />
          <ChoiceGrid
            label="Diminished"
            value={settings.diminished}
            choices={DIMINISHED_CHOICES}
            onChange={(value) => setField("diminished", value)}
          />
          <ChoiceGrid
            label="Half-diminished"
            value={settings.halfDiminished}
            choices={HALF_DIMINISHED_CHOICES}
            onChange={(value) => setField("halfDiminished", value)}
          />
          <ChoiceGrid
            label="Augmented"
            value={settings.augmented}
            choices={AUGMENTED_CHOICES}
            onChange={(value) => setField("augmented", value)}
          />
          <ChoiceGrid
            label="Extensions"
            value={settings.extensions}
            choices={EXTENSION_CHOICES}
            onChange={(value) => setField("extensions", value)}
          />
        </div>
      </Collapsible>
    </div>
  );
}
