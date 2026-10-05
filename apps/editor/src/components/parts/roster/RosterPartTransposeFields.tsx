import { X } from "lucide-react";
import { Checkbox, Collapsible, FormField, FormInput, IconButton, Tooltip } from "@viritura/ui";
import {
  KEY_FIFTHS_FLIP_AT_DESCRIPTION,
  PREFERS_WRITTEN_PITCHES_DESCRIPTION,
  buildTransposition,
  type PartUpdate,
} from "./transposition";
import styles from "./RosterPartTransposeFields.module.css";
import { TranspositionPitchFields } from "../transpositionPitch";

interface Props {
  partId: string | undefined;
  instrumentId?: string;
  chromatic: number;
  staffDistance: number;
  keyFifthsFlipAt: number | "";
  prefersWritten: boolean;
  setChromatic: (n: number) => void;
  setStaffDistance: (n: number) => void;
  setKeyFifthsFlipAt: (v: number | "") => void;
  setPrefersWritten: (b: boolean) => void;
  commit: () => void;
  onUpdate?: (partId: string, updates: PartUpdate) => void;
}

/** The "Transposition" subsection of the expanded part editor. */
export function RosterPartTransposeFields(props: Props) {
  const {
    partId,
    instrumentId,
    chromatic,
    staffDistance,
    keyFifthsFlipAt,
    prefersWritten,
    setChromatic,
    setStaffDistance,
    setKeyFifthsFlipAt,
    setPrefersWritten,
    commit,
    onUpdate,
  } = props;

  return (
    <section className={styles.root} aria-labelledby={`transposition-${partId ?? "part"}`}>
      <div className={styles.heading}>
        <span id={`transposition-${partId ?? "part"}`} className={styles.sectionLabel}>
          Transposition
        </span>
      </div>
      <TranspositionPitchFields
        instrumentId={instrumentId}
        halfSteps={chromatic}
        staffDistance={staffDistance}
        onChange={(next, nextSd) => {
          setChromatic(next);
          setStaffDistance(nextSd);
          if (partId && onUpdate) {
            onUpdate(partId, {
              transposition: buildTransposition(next, nextSd, keyFifthsFlipAt, prefersWritten),
            });
          }
        }}
      />
      <Tooltip content={PREFERS_WRITTEN_PITCHES_DESCRIPTION}>
        <div className={styles.writtenPitches}>
          <Checkbox
            label="Display written pitches by default"
            checked={prefersWritten}
            onChange={(e) => {
              const next = e.target.checked;
              setPrefersWritten(next);
              if (partId && onUpdate) {
                onUpdate(partId, {
                  transposition: buildTransposition(chromatic, staffDistance, keyFifthsFlipAt, next),
                });
              }
            }}
          />
        </div>
      </Tooltip>
      <Collapsible title="Advanced transposition" className={styles.advanced}>
        <div className={styles.advancedFields}>
          <FormField label="Key flip at">
            <div className={styles.keyFlipRow}>
              <FormInput
                type="number"
                value={keyFifthsFlipAt}
                placeholder="—"
                title={KEY_FIFTHS_FLIP_AT_DESCRIPTION}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setKeyFifthsFlipAt("");
                  } else {
                    const n = parseInt(raw);
                    setKeyFifthsFlipAt(Number.isFinite(n) ? n : "");
                  }
                }}
                onBlur={commit}
                className={styles.keyFlipInput}
              />
              {keyFifthsFlipAt !== "" && (
                <IconButton
                  size="sm"
                  tooltip="Clear key flip threshold (never flip enharmonically)"
                  onClick={() => {
                    setKeyFifthsFlipAt("");
                    if (partId && onUpdate) {
                      onUpdate(partId, {
                        transposition: buildTransposition(chromatic, staffDistance, "", prefersWritten),
                      });
                    }
                  }}
                >
                  <X size={12} />
                </IconButton>
              )}
            </div>
          </FormField>
        </div>
      </Collapsible>
    </section>
  );
}
