import { useCallback, useState, type CSSProperties } from "react";
import type { Part } from "@viritura/core";
import type { PartDisplayInfo } from "@viritura/core";
import { Button, FormField, FormInput } from "@viritura/ui";
import { Repeat2 } from "lucide-react";
import { isPercussionPart } from "../../../score/kitInput";
import { KitMappingPreview, type KitComponentEdit } from "../../DrumKitDialog";
import { buildTransposition, partEditBuffersFor, type PartUpdate } from "./transposition";
import { RosterPartHeader } from "./RosterPartHeader";
import { RosterPartTransposeFields } from "./RosterPartTransposeFields";
import { RosterPartRemoveButton } from "./RosterPartRemoveButton";
import { RosterPartDrumKitButton } from "./RosterPartDrumKitButton";
import { getCatalogInstrument } from "../../../score/InstrumentCatalog";

const ROSTER_ROW_ROOT_STYLE: CSSProperties = { borderBottom: "1px solid var(--border, rgba(20, 20, 28, 0.06))" };
const ROSTER_ROW_EXPANDED_STYLE: CSSProperties = {
  padding: "10px 12px 14px 26px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  background: "linear-gradient(180deg, rgba(20, 20, 28, 0.025), rgba(20, 20, 28, 0.01))",
  borderTop: "1px solid rgba(20, 20, 28, 0.05)",
};
const KIT_PREVIEW_LABEL_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: "var(--type-heading-weight)",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginTop: 6,
};
const INSTRUMENT_IDENTITY_STYLE: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  color: "var(--text-muted)",
  fontSize: "var(--type-small-size)",
  marginBottom: 4,
};

export interface RosterPartRowProps {
  part: Part;
  info?: PartDisplayInfo;
  expanded: boolean;
  canRemove: boolean;
  onToggle: () => void;
  onUpdate?: (partId: string, updates: PartUpdate) => void;
  onRemove?: (partId: string) => void;
  /** Open the per-part drum-kit editor (only offered for percussion parts). */
  onEditDrumKit?: (partId: string) => void;
  onChangeInstrument?: (partId: string) => void;
  /** Resolved kit-mapping rows for a percussion part (drives the inline
   *  preview). Null for non-percussion parts or when not expanded. */
  kitRows?: readonly KitComponentEdit[] | null;
}

/** Single row in the parts roster. Collapsed shows just the header;
 *  expanded reveals name / short name / transposition / remove. */
export function RosterPartRow({
  part,
  info,
  expanded,
  canRemove,
  onToggle,
  onUpdate,
  onRemove,
  onEditDrumKit,
  onChangeInstrument,
  kitRows,
}: RosterPartRowProps) {
  const initial = partEditBuffersFor(part);
  const [name, setName] = useState(initial.name);
  const [shortName, setShortName] = useState(initial.shortName);
  const [chromatic, setChromatic] = useState(initial.chromatic);
  const [staffDistance, setStaffDistance] = useState(initial.staffDistance);
  // "" means unset (no key flip). Number means explicit value (incl. 0).
  const [keyFifthsFlipAt, setKeyFifthsFlipAt] = useState<number | "">(initial.keyFifthsFlipAt);
  const [prefersWritten, setPrefersWritten] = useState(initial.prefersWritten);

  // Reset local edit buffers when the underlying part identity changes
  // (undo/redo, rename from somewhere else). Using the "compare prev prop
  // during render" pattern recommended by the React 19 docs over an effect
  // — it avoids cascading renders that the effect-based version triggers.
  const [prevPart, setPrevPart] = useState(part);
  if (prevPart !== part) {
    const next = partEditBuffersFor(part);
    setPrevPart(part);
    setName(next.name);
    setShortName(next.shortName);
    setChromatic(next.chromatic);
    setStaffDistance(next.staffDistance);
    setKeyFifthsFlipAt(next.keyFifthsFlipAt);
    setPrefersWritten(next.prefersWritten);
  }

  const commit = useCallback(() => {
    if (!part.id || !onUpdate) return;
    const updates: PartUpdate = {
      name,
      shortName: shortName || undefined,
      transposition: buildTransposition(chromatic, staffDistance, keyFifthsFlipAt, prefersWritten),
    };
    onUpdate(part.id, updates);
  }, [part.id, onUpdate, name, shortName, chromatic, staffDistance, keyFifthsFlipAt, prefersWritten]);

  const displayName = info?.displayName ?? part.name;
  const displayShort = info?.displayShortName ?? part.shortName;
  const isPercussion = isPercussionPart(part);
  const catalogInstrument = part._x?.viritura?.instrumentId
    ? getCatalogInstrument(part._x.viritura.instrumentId)
    : undefined;

  return (
    <div style={ROSTER_ROW_ROOT_STYLE}>
      <RosterPartHeader
        part={part}
        displayName={displayName}
        displayShort={displayShort}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div style={ROSTER_ROW_EXPANDED_STYLE}>
          {catalogInstrument && (
            <div style={INSTRUMENT_IDENTITY_STYLE}>
              <span>Instrument</span>
              <strong>{catalogInstrument.name}</strong>
            </div>
          )}
          {part.id && onChangeInstrument && (
            <Button fullWidth size="sm" variant="default" onClick={() => onChangeInstrument(part.id!)}>
              <Repeat2 size={11} />
              Change Instrument…
            </Button>
          )}
          <FormField label="Name">
            <FormInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </FormField>
          <FormField label="Short name">
            <FormInput
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="e.g. Fl."
            />
          </FormField>
          {isPercussion ? (
            // Percussion parts don't transpose — show the drum-kit mapping
            // instead, with editing deferred to the full Drum Kit dialog.
            <>
              {kitRows ? (
                <>
                  <span style={KIT_PREVIEW_LABEL_STYLE}>Percussion map</span>
                  <KitMappingPreview rows={kitRows} />
                </>
              ) : null}
              {onEditDrumKit && part.id && <RosterPartDrumKitButton partId={part.id} onEditDrumKit={onEditDrumKit} />}
            </>
          ) : (
            <RosterPartTransposeFields
              partId={part.id}
              name={name}
              shortName={shortName}
              chromatic={chromatic}
              staffDistance={staffDistance}
              keyFifthsFlipAt={keyFifthsFlipAt}
              prefersWritten={prefersWritten}
              setChromatic={setChromatic}
              setStaffDistance={setStaffDistance}
              setKeyFifthsFlipAt={setKeyFifthsFlipAt}
              setPrefersWritten={setPrefersWritten}
              commit={commit}
              onUpdate={onUpdate}
            />
          )}
          {canRemove && onRemove && part.id && (
            <RosterPartRemoveButton partId={part.id} displayName={displayName} onRemove={onRemove} />
          )}
        </div>
      )}
    </div>
  );
}
