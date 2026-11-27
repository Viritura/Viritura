import { ChevronDown, ChevronUp } from "lucide-react";
import type { HarpPedalLetter, HarpPedalTuning } from "@viritura/core";
import { Button } from "@viritura/ui";
import { HARP_PEDAL_ORDER, moveHarpPedal } from "./harpPedalText";
import styles from "./HarpPedalPopover.module.css";

interface Props {
  tuning: HarpPedalTuning | null;
  onChange: (tuning: HarpPedalTuning) => void;
}

export function HarpPedalControls({ tuning, onChange }: Props) {
  function move(letter: HarpPedalLetter, direction: "up" | "down"): void {
    if (!tuning) return;
    const current = tuning[letter];
    const next = moveHarpPedal(current, direction);
    if (next === current) return;
    onChange({ ...tuning, [letter]: next });
  }

  return (
    <div className={styles.pedals} role="group" aria-label="Harp pedal positions">
      {HARP_PEDAL_ORDER.map((letter, index) => {
        const alter = tuning?.[letter];
        const accidental = alter === -1 ? "♭" : alter === 0 ? "♮" : alter === 1 ? "♯" : "?";
        const description = alter === -1 ? "flat" : alter === 0 ? "natural" : alter === 1 ? "sharp" : "unknown";
        const descriptionId = `harp-pedal-position-${letter}`;
        return (
          <div className={index === 2 ? styles.leftDivider : styles.pedal} key={letter}>
            <Button
              shape="icon"
              size="sm"
              ariaLabel={`Raise ${letter} pedal`}
              aria-describedby={descriptionId}
              disabled={alter === undefined || alter === -1}
              onClick={() => move(letter, "up")}
            >
              <ChevronUp size={16} aria-hidden />
            </Button>
            <span id={descriptionId} role="img" aria-label={`${letter} ${description}`}>
              {letter}
              {accidental}
            </span>
            <Button
              shape="icon"
              size="sm"
              ariaLabel={`Lower ${letter} pedal`}
              aria-describedby={descriptionId}
              disabled={alter === undefined || alter === 1}
              onClick={() => move(letter, "down")}
            >
              <ChevronDown size={16} aria-hidden />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
