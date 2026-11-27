import type { CSSProperties, ReactNode } from "react";
import { FormField, PaletteButton } from "@viritura/ui";
import type { BarNumberSettings, ResolvedTextStyle } from "@viritura/core";
import styles from "./BarNumbersPanel.module.css";

type Settings = Required<Pick<BarNumberSettings, "horizontalAlignment" | "enclosure">> &
  Pick<ResolvedTextStyle, "family" | "size" | "bold" | "italic">;

interface PaletteChoiceProps<T extends string> {
  label: string;
  value: T;
  choices: readonly { value: T; label: string; preview: ReactNode }[];
  onChange: (value: T) => void;
}

function PaletteChoice<T extends string>({ label, value, choices, onChange }: PaletteChoiceProps<T>) {
  return (
    <FormField label={label}>
      <div className={styles.choiceGrid} role="radiogroup">
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
    </FormField>
  );
}

const FONT_STACKS: Record<Settings["family"], string> = {
  serif: '"Viritura Serif", serif',
  "sans-serif": "sans-serif",
  monospace: "monospace",
};

function numberStyle(settings: Settings): CSSProperties {
  return {
    fontFamily: FONT_STACKS[settings.family],
    fontSize: `${Math.min(18, Math.max(11, settings.size * 6))}px`,
    fontWeight: settings.bold ? 700 : 400,
    fontStyle: settings.italic ? "italic" : "normal",
  };
}

/** A staff fragment between two barlines with the bar number above the left barline or the bar's center. */
function AlignmentSpecimen({ centered, settings }: { centered: boolean; settings: Settings }) {
  return (
    <svg className={styles.alignmentSpecimen} viewBox="0 0 64 36" aria-hidden="true">
      {[18, 22, 26, 30, 34].map((y) => (
        <line key={y} x1="4" x2="60" y1={y} y2={y} className={styles.staffLine} />
      ))}
      <line x1="4" x2="4" y1="18" y2="34" className={styles.barline} />
      <line x1="60" x2="60" y1="18" y2="34" className={styles.barline} />
      <text x={centered ? 32 : 4} y="13" textAnchor={centered ? "middle" : "start"} style={numberStyle(settings)}>
        12
      </text>
    </svg>
  );
}

interface StyleChoiceProps<K extends keyof Settings> {
  settings: Settings;
  onChange: (value: Settings[K]) => void;
}

export function HorizontalAlignmentChoice({ settings, onChange }: StyleChoiceProps<"horizontalAlignment">) {
  return (
    <PaletteChoice
      label="Horizontal alignment"
      value={settings.horizontalAlignment}
      choices={[
        {
          value: "barline",
          label: "At barline",
          preview: <AlignmentSpecimen centered={false} settings={settings} />,
        },
        { value: "center", label: "Centered in bar", preview: <AlignmentSpecimen centered settings={settings} /> },
      ]}
      onChange={onChange}
    />
  );
}

export function EnclosureChoice({ settings, onChange }: StyleChoiceProps<"enclosure">) {
  const style = numberStyle(settings);
  return (
    <PaletteChoice
      label="Enclosure"
      value={settings.enclosure}
      choices={[
        { value: "none", label: "None", preview: <span style={style}>12</span> },
        {
          value: "box",
          label: "Box",
          preview: (
            <span className={styles.box} style={style}>
              12
            </span>
          ),
        },
        {
          value: "circle",
          label: "Circle",
          preview: (
            <span className={styles.circle} style={style}>
              12
            </span>
          ),
        },
      ]}
      onChange={onChange}
    />
  );
}
