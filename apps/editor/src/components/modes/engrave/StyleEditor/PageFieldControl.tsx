import {
  PAGE_SIZE_PRESETS,
  RASTRAL_SPATIUM_MM,
  type PageSetup,
  type PageSetupOverride,
  type PageTurnSettings,
} from "@viritura/core";
import { ButtonGroup, Select } from "@viritura/ui";
import { UnitInput } from "../../../PageSetupDialog";
import { PAGE_SIZE_NAMES, RASTRAL_LABELS, findPageSizeName, findRastralIndex } from "../../../pageSetupHelpers";
import type { PageFieldDefinition } from "../../../../engraveStyle";
import styles from "./StyleEditor.module.css";

interface PageFieldControlProps {
  field: PageFieldDefinition;
  setup: PageSetup;
  /** This layer's stored page turns, kept when switching the page-turn mode. */
  storedPageTurns: PageTurnSettings | undefined;
  labelId: string;
  onChange: (values: PageSetupOverride) => void;
}

type Orientation = PageSetup["orientation"];

function oriented(width: number, height: number, orientation: Orientation): PageSetupOverride {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return orientation === "landscape"
    ? { width: long, height: short, orientation }
    : { width: short, height: long, orientation };
}

function PageSizeControl({ setup, onChange }: Pick<PageFieldControlProps, "setup" | "onChange">) {
  const name = findPageSizeName(setup.width, setup.height);
  return (
    <div className={styles.controlStack}>
      <Select
        aria-label="Page size"
        value={name}
        options={[...PAGE_SIZE_NAMES.map((value) => ({ value, label: value })), { value: "Custom", label: "Custom" }]}
        onValueChange={(value) => {
          const preset = PAGE_SIZE_PRESETS[value];
          if (preset) onChange(oriented(preset.width, preset.height, setup.orientation));
        }}
      />
      <ButtonGroup
        options={[
          { value: "portrait", label: "Portrait" },
          { value: "landscape", label: "Landscape" },
        ]}
        value={setup.orientation}
        onChange={(orientation) => onChange(oriented(setup.width, setup.height, orientation))}
      />
      {name === "Custom" && (
        <div className={styles.controlPair}>
          <span id="style-page-width" className={styles.unit}>
            Width
          </span>
          <UnitInput
            aria-labelledby="style-page-width"
            value={setup.width}
            min={50}
            max={1000}
            onChange={(width) => onChange({ width, height: setup.height, orientation: setup.orientation })}
          />
          <span id="style-page-height" className={styles.unit}>
            Height
          </span>
          <UnitInput
            aria-labelledby="style-page-height"
            value={setup.height}
            min={50}
            max={1000}
            onChange={(height) => onChange({ width: setup.width, height, orientation: setup.orientation })}
          />
        </div>
      )}
    </div>
  );
}

function StaffSizeControl({ setup, onChange }: Pick<PageFieldControlProps, "setup" | "onChange">) {
  const rastral = findRastralIndex(setup.spatiumMm);
  return (
    <Select
      aria-label="Staff size"
      value={String(rastral)}
      options={[
        ...RASTRAL_LABELS.map((label, index) => ({ value: String(index), label: `Rastral ${label}` })),
        ...(rastral === -1 ? [{ value: "-1", label: `Custom (${(setup.spatiumMm * 4).toFixed(2)} mm)` }] : []),
      ]}
      onValueChange={(value) => {
        const spatiumMm = RASTRAL_SPATIUM_MM[Number(value)];
        if (spatiumMm !== undefined) onChange({ spatiumMm });
      }}
    />
  );
}

const MARGIN_SIDES = {
  marginTop: "top",
  marginBottom: "bottom",
  marginLeft: "left",
  marginRight: "right",
} as const;

export function PageFieldControl({ field, setup, storedPageTurns, labelId, onChange }: PageFieldControlProps) {
  switch (field.id) {
    case "pageSize":
      return <PageSizeControl setup={setup} onChange={onChange} />;
    case "staffSize":
      return <StaffSizeControl setup={setup} onChange={onChange} />;
    case "pageTurns": {
      const mode = !setup.pageTurns?.enabled ? "off" : (setup.pageTurns.preset ?? "relaxed");
      return (
        <Select
          aria-label="Page turns"
          value={mode}
          options={[
            { value: "off", label: "Off" },
            { value: "relaxed", label: "Relaxed (easy turns)" },
            { value: "professional", label: "Professional (dense pages)" },
          ]}
          onValueChange={(value) =>
            onChange({
              pageTurns:
                value === "off"
                  ? { ...storedPageTurns, enabled: false }
                  : {
                      ...storedPageTurns,
                      enabled: true,
                      preset: value === "professional" ? "professional" : "relaxed",
                    },
            })
          }
        />
      );
    }
    default: {
      const side = MARGIN_SIDES[field.id];
      return (
        <div className={styles.controlPair}>
          <UnitInput
            aria-labelledby={labelId}
            value={setup.margins[side]}
            min={0}
            max={100}
            onChange={(mm) => onChange({ margins: { [side]: mm } })}
          />
          <span className={styles.unit}>mm</span>
        </div>
      );
    }
  }
}
