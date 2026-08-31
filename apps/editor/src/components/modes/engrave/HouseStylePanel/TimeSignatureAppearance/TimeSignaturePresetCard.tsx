import { PaletteButton } from "@viritura/ui";
import { TimeSignatureStaffPreview } from "../../../../palette";
import type { TimeSignaturePreset, TimeSignaturePresetId } from "./timeSignatureAppearanceModel";
import styles from "./TimeSignatureAppearance.module.css";

interface TimeSignaturePresetCardProps {
  preset: TimeSignaturePreset;
  selected: boolean;
  onSelect: (id: TimeSignaturePresetId) => void;
}

function PresetSpecimen({ id }: { id: TimeSignaturePreset["id"] }) {
  const common = {
    count: 4,
    unit: 4,
    staffCount: 2,
    width: 124,
    signatureX: 16,
    staffStart: 10,
    staffEnd: 118,
    className: styles.presetSpecimen,
  } as const;

  switch (id) {
    case "standard":
      return <TimeSignatureStaffPreview {...common} />;
    case "largePerStaff":
      return <TimeSignatureStaffPreview {...common} scale={1.5} />;
    case "filmScore":
      return (
        <TimeSignatureStaffPreview
          {...common}
          scale={8}
          numeralStyle="outsideStaff"
          distribution="perGroup"
          showBracket
        />
      );
    case "aboveGroup":
      return <TimeSignatureStaffPreview {...common} distribution="perGroup" position="above" showBracket />;
  }
}

export function TimeSignaturePresetCard({ preset, selected, onSelect }: TimeSignaturePresetCardProps) {
  return (
    <PaletteButton
      shape="vertical"
      selectionMode="radio"
      active={selected}
      title={preset.label}
      onClick={() => onSelect(preset.id)}
      className={styles.presetButton}
    >
      <span className={styles.presetCardContent}>
        <PresetSpecimen id={preset.id} />
        <span className={styles.presetLabel}>{preset.label}</span>
      </span>
    </PaletteButton>
  );
}
