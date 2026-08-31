import { X } from "lucide-react";
import type { CSSProperties } from "react";
import { Checkbox, FormField, FormInput, IconButton, Tooltip } from "@viritura/ui";
import {
  CHROMATIC_DESCRIPTION,
  STAFF_DISTANCE_DESCRIPTION,
  KEY_FIFTHS_FLIP_AT_DESCRIPTION,
  PREFERS_WRITTEN_PITCHES_DESCRIPTION,
  buildTransposition,
  defaultKeyFifthsFlipAt,
  diatonicFromChromatic,
  type PartUpdate,
} from "./transposition";

const TRANSPOSE_ROOT_STYLE: CSSProperties = {
  marginTop: 10,
  paddingTop: 10,
  borderTop: "1px solid rgba(20, 20, 28, 0.08)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const TRANSPOSE_LABEL_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: "var(--type-heading-weight)",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 4,
};
const TRANSPOSE_ROW_STYLE: CSSProperties = { display: "flex", gap: 8 };
const TRANSPOSE_COL_STYLE: CSSProperties = { flex: 1, minWidth: 0 };
const FULL_WIDTH_INPUT_STYLE: CSSProperties = { width: "100%" };
const KEY_FLIP_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 4 };
const KEY_FLIP_INPUT_STYLE: CSSProperties = { width: 72 };
const PREFERS_WRITTEN_WRAP_STYLE: CSSProperties = { marginTop: 2 };

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
    <div style={TRANSPOSE_ROOT_STYLE}>
      <div style={TRANSPOSE_LABEL_STYLE}>Transposition</div>
      <div style={TRANSPOSE_ROW_STYLE}>
        <div style={TRANSPOSE_COL_STYLE}>
          <FormField label="Chromatic">
            <FormInput
              type="number"
              value={chromatic}
              title={CHROMATIC_DESCRIPTION}
              onChange={(e) => {
                const next = parseInt(e.target.value) || 0;
                setChromatic(next);
                // Auto-fill staff distance to the natural diatonic
                // interpretation; user can still override afterwards.
                const nextSd = diatonicFromChromatic(next);
                setStaffDistance(nextSd);
                // Reset the key-flip threshold to a sensible default
                // for the new chromatic — sharpward transpositions
                // flip at +7, flatward at -7. User can then override
                // or clear via the ✕ button next to the field.
                const nextFlip = defaultKeyFifthsFlipAt(next);
                setKeyFifthsFlipAt(nextFlip);
                // Commit immediately so the auto-derived "in X" suffix
                // in the part name updates as the user types, rather
                // than waiting for blur.
                if (partId && onUpdate) {
                  onUpdate(partId, {
                    name,
                    shortName: shortName || undefined,
                    transposition: buildTransposition(next, nextSd, nextFlip, prefersWritten),
                  });
                }
              }}
              onBlur={commit}
              style={FULL_WIDTH_INPUT_STYLE}
            />
          </FormField>
        </div>
        <div style={TRANSPOSE_COL_STYLE}>
          <FormField label="Staff distance">
            <FormInput
              type="number"
              value={staffDistance}
              title={STAFF_DISTANCE_DESCRIPTION}
              onChange={(e) => setStaffDistance(parseInt(e.target.value) || 0)}
              onBlur={commit}
              style={FULL_WIDTH_INPUT_STYLE}
            />
          </FormField>
        </div>
      </div>
      <FormField label="Key flip at">
        <div style={KEY_FLIP_ROW_STYLE}>
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
            style={KEY_FLIP_INPUT_STYLE}
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
      <Tooltip content={PREFERS_WRITTEN_PITCHES_DESCRIPTION}>
        <div style={PREFERS_WRITTEN_WRAP_STYLE}>
          <Checkbox
            label="Prefers written pitches"
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
    </div>
  );
}
