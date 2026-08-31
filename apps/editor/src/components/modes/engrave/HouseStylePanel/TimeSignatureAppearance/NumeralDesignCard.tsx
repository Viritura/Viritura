import { PaletteButton } from "@viritura/ui";
import type { TimeSignatureRenderStyle } from "@viritura/core";
import { TimeSignatureStaffPreview } from "../../../../palette";
import styles from "./TimeSignatureAppearance.module.css";

interface NumeralDesignCardProps {
  design: { value: TimeSignatureRenderStyle; label: string };
  selected: boolean;
  onSelect: (value: TimeSignatureRenderStyle) => void;
}

function specimenScale(style: TimeSignatureRenderStyle): number {
  if (style === "outsideStaff") return 3;
  if (style === "singleNumber") return 1.5;
  return 1;
}

export function NumeralDesignCard({ design, selected, onSelect }: NumeralDesignCardProps) {
  return (
    <PaletteButton
      shape="vertical"
      selectionMode="radio"
      active={selected}
      title={design.label}
      onClick={() => onSelect(design.value)}
      className={styles.numeralButton}
    >
      <span className={styles.numeralCardContent}>
        <TimeSignatureStaffPreview
          count={4}
          unit={4}
          numeralStyle={design.value}
          scale={specimenScale(design.value)}
          width={108}
          signatureX={14}
          staffStart={8}
          staffEnd={104}
          className={styles.numeralSpecimen}
        />
        <span className={styles.numeralLabel}>{design.label}</span>
      </span>
    </PaletteButton>
  );
}
