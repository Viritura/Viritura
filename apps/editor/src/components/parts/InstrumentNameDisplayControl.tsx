import type { CSSProperties } from "react";
import { Select, type SelectOption } from "@viritura/ui";
import {
  instrumentNameDisplayFor,
  type InstrumentNameDisplayPolicy,
  type InstrumentNameDisplayValue,
} from "./instrumentNameDisplay";
import type { LayoutContent } from "@viritura/core";

const OPTIONS: readonly SelectOption[] = [
  { value: "fullThenShort", label: "First full, then short" },
  { value: "short", label: "Short on every system" },
  { value: "hidden", label: "Hidden" },
  { value: "custom", label: "Custom layout", disabled: true },
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
const HELP_STYLE: CSSProperties = {
  marginTop: 4,
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
};

export interface InstrumentNameDisplayControlProps {
  content: readonly LayoutContent[];
  onChange: (policy: InstrumentNameDisplayPolicy) => void;
}

export function InstrumentNameDisplayControl({ content, onChange }: InstrumentNameDisplayControlProps) {
  const value: InstrumentNameDisplayValue = instrumentNameDisplayFor(content);
  return (
    <div
      style={ROOT_STYLE}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <label style={LABEL_STYLE} htmlFor="instrument-name-display">
        Instrument label display
      </label>
      <Select
        id="instrument-name-display"
        aria-label="Instrument label display"
        value={value}
        options={OPTIONS}
        onValueChange={(next) => {
          if (next !== "custom") onChange(next as InstrumentNameDisplayPolicy);
        }}
      />
      <div style={HELP_STYLE}>Full and short label text is edited in Instruments.</div>
    </div>
  );
}
