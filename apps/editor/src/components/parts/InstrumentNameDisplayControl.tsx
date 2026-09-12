import type { CSSProperties } from "react";
import { FormField, Select, type SelectOption } from "@viritura/ui";
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
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};
const LABEL_STYLE: CSSProperties = {
  display: "block",
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};
const HELP_STYLE: CSSProperties = {
  margin: 0,
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
      <div style={LABEL_STYLE}>Instrument Labels</div>
      <FormField label="First system" horizontal>
        <Select
          aria-label="First system instrument labels"
          value={values.firstSystem}
          options={OPTIONS}
          onValueChange={(next) => {
            if (next !== "custom") onChange(nextSettings(values, "firstSystem", next as InstrumentNameDisplayPolicy));
          }}
        />
      </FormField>
      <FormField label="Later systems" horizontal>
        <Select
          aria-label="Subsequent systems instrument labels"
          value={values.subsequentSystems}
          options={OPTIONS}
          onValueChange={(next) => {
            if (next !== "custom") {
              onChange(nextSettings(values, "subsequentSystems", next as InstrumentNameDisplayPolicy));
            }
          }}
        />
      </FormField>
      <p style={HELP_STYLE}>Edit full and short label text in Setup → Instruments.</p>
    </div>
  );
}
