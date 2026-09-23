import { useCallback, useState, type MouseEventHandler } from "react";
import type { Part } from "@viritura/core";
import type { PartDisplayInfo } from "@viritura/core";
import { FormField, FormInput, Select, SettingsRow } from "@viritura/ui";
import { isPercussionPart } from "../../../score/kitInput";
import { KitMappingPreview, type KitComponentEdit } from "../../DrumKitDialog";
import { buildTransposition, partEditBuffersFor, type PartUpdate } from "./transposition";
import { RosterPartHeader } from "./RosterPartHeader";
import { RosterPartTransposeFields } from "./RosterPartTransposeFields";
import { getCatalogInstrument } from "../../../score/InstrumentCatalog";
import styles from "./RosterPartRow.module.css";
import { CHORD_SYMBOL_VISIBILITY_OPTIONS } from "../chordSymbolVisibility";

export interface RosterPartRowProps {
  part: Part;
  info?: PartDisplayInfo;
  expanded: boolean;
  onToggle: () => void;
  onContextMenu?: MouseEventHandler<HTMLButtonElement>;
  onUpdate?: (partId: string, updates: PartUpdate) => void;
  /** Resolved kit-mapping rows for a percussion part (drives the inline
   *  preview). Null for non-percussion parts or when not expanded. */
  kitRows?: readonly KitComponentEdit[] | null;
}

/** Single row in the parts roster. Collapsed shows just the header;
 *  expanded reveals editable identity, notation, and playback properties. */
export function RosterPartRow({
  part,
  info,
  expanded,
  onToggle,
  onContextMenu,
  onUpdate,
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
  const isPercussion = isPercussionPart(part);
  const catalogInstrument = part._x?.viritura?.instrumentId
    ? getCatalogInstrument(part._x.viritura.instrumentId)
    : undefined;

  return (
    <div className={styles.root}>
      <RosterPartHeader
        displayName={displayName}
        expanded={expanded}
        onToggle={onToggle}
        onContextMenu={onContextMenu}
      />
      {expanded && (
        <div className={styles.expanded}>
          <SettingsRow label="Instrument">
            <span className={styles.instrumentValue}>{catalogInstrument?.name ?? part.name}</span>
          </SettingsRow>
          <div className={styles.nameFields}>
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
          </div>
          <FormField label="Chord symbols">
            <Select
              aria-label={`Chord symbols for ${displayName}`}
              value={part.chordSymbolVisibility ?? "auto"}
              options={CHORD_SYMBOL_VISIBILITY_OPTIONS}
              disabled={!part.id || !onUpdate}
              onValueChange={(value) => {
                if (part.id && (value === "auto" || value === "show" || value === "hide")) {
                  onUpdate?.(part.id, { chordSymbolVisibility: value });
                }
              }}
            />
          </FormField>
          {isPercussion ? (
            // Percussion parts don't transpose — show the drum-kit mapping
            // instead, with editing deferred to the full Drum Kit dialog.
            <>
              {kitRows ? (
                <>
                  <span className={styles.sectionLabel}>Percussion map</span>
                  <KitMappingPreview rows={kitRows} />
                </>
              ) : null}
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
        </div>
      )}
    </div>
  );
}
