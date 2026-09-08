import type { CSSProperties } from "react";
import { Select, type SelectOption } from "@viritura/ui";
import {
  instrumentNameDisplayFor,
  type InstrumentNameDisplayPolicy,
  type InstrumentNameDisplaySettings,
} from "./instrumentNameDisplay";
import type { LayoutContent, ScoreDefinition } from "@viritura/core";

const OPTIONS: readonly SelectOption[] = [
  { value: "full", label: "Full" },
  { value: "short", label: "Short" },
  { value: "hidden", label: "Hidden" },
  { value: "custom", label: "Custom/imported", disabled: true },
];

const ROOT_STYLE: CSSProperties = {
  padding: "6px 12px 10px",
  background: "rgba(var(--accent-rgb, 33, 94, 78), 0.04)",
};
const LABEL_STYLE: CSSProperties = {
  display: "block",
  marginBottom: 4,
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: 700,
};
const FIELD_STYLE: CSSProperties = { display: "grid", gap: 4 };
const FIELDS_STYLE: CSSProperties = { display: "grid", gap: 8 };
const HELP_STYLE: CSSProperties = {
  marginTop: 4,
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
};

export interface InstrumentNameDisplayControlProps {
  content: readonly LayoutContent[];
  score: ScoreDefinition;
  onChange: (settings: InstrumentNameDisplaySettings) => void;
}

function nextSettings(
  values: ReturnType<typeof instrumentNameDisplayFor>,
  key: keyof InstrumentNameDisplaySettings,
  policy: InstrumentNameDisplayPolicy,
): InstrumentNameDisplaySettings {
  return {
    firstSystem: values.firstSystem === "custom" ? "full" : values.firstSystem,
    subsequentSystems: values.subsequentSystems === "custom" ? "short" : values.subsequentSystems,
    [key]: policy,
  };
}

export function InstrumentNameDisplayControl({ content, score, onChange }: InstrumentNameDisplayControlProps) {
  const values = instrumentNameDisplayFor(content, score);
  return (
    <div
      style={ROOT_STYLE}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div style={LABEL_STYLE}>Instrument label display</div>
      <div style={FIELDS_STYLE}>
        <label style={FIELD_STYLE} htmlFor={`instrument-name-first-${score.name ?? "score"}`}>
          <span>First system</span>
          <Select
            id={`instrument-name-first-${score.name ?? "score"}`}
            aria-label="First system instrument labels"
            value={values.firstSystem}
            options={OPTIONS}
            onValueChange={(next) => {
              if (next !== "custom") onChange(nextSettings(values, "firstSystem", next as InstrumentNameDisplayPolicy));
            }}
          />
        </label>
        <label style={FIELD_STYLE} htmlFor={`instrument-name-subsequent-${score.name ?? "score"}`}>
          <span>Subsequent systems</span>
          <Select
            id={`instrument-name-subsequent-${score.name ?? "score"}`}
            aria-label="Subsequent systems instrument labels"
            value={values.subsequentSystems}
            options={OPTIONS}
            onValueChange={(next) => {
              if (next !== "custom") {
                onChange(nextSettings(values, "subsequentSystems", next as InstrumentNameDisplayPolicy));
              }
            }}
          />
        </label>
      </div>
      <div style={HELP_STYLE}>Full and short label text is edited in Instruments.</div>
    </div>
  );
}
