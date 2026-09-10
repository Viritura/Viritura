import { X } from "lucide-react";
import { Checkbox, Collapsible, FormField, FormInput, IconButton, Tooltip } from "@viritura/ui";
import {
  CHROMATIC_DESCRIPTION,
  STAFF_DISTANCE_DESCRIPTION,
  KEY_FIFTHS_FLIP_AT_DESCRIPTION,
  PREFERS_WRITTEN_PITCHES_DESCRIPTION,
  buildTransposition,
  defaultKeyFifthsFlipAt,
  diatonicFromChromatic,
  transpositionSummary,
  type PartUpdate,
} from "./transposition";
import styles from "./RosterPartTransposeFields.module.css";

interface Props {
  partId: string | undefined;
  name: string;
  shortName: string;
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
    name,
    shortName,
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
        <p className={styles.summary}>{transpositionSummary(chromatic)}</p>
      </div>
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
          <div className={styles.fieldRow}>
            <FormField label="Chromatic">
              <FormInput
                type="number"
                value={chromatic}
                title={CHROMATIC_DESCRIPTION}
                onChange={(e) => {
                  const next = parseInt(e.target.value) || 0;
                  setChromatic(next);
                  const nextSd = diatonicFromChromatic(next);
                  setStaffDistance(nextSd);
                  const nextFlip = defaultKeyFifthsFlipAt(next);
                  setKeyFifthsFlipAt(nextFlip);
                  if (partId && onUpdate) {
                    onUpdate(partId, {
                      name,
                      shortName: shortName || undefined,
                      transposition: buildTransposition(next, nextSd, nextFlip, prefersWritten),
                    });
                  }
                }}
                onBlur={commit}
                className={styles.fullWidth}
              />
            </FormField>
            <FormField label="Staff distance">
              <FormInput
                type="number"
                value={staffDistance}
                title={STAFF_DISTANCE_DESCRIPTION}
                onChange={(e) => setStaffDistance(parseInt(e.target.value) || 0)}
                onBlur={commit}
                className={styles.fullWidth}
              />
            </FormField>
          </div>
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
