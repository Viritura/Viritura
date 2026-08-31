import type { ClefSign, KitComponent, Part, Sound } from "@viritura/core";
import type { CatalogInstrument, KitComponentDef } from "./InstrumentCatalog";
import { buildPartTransposition } from "./InstrumentCatalog";

export interface CatalogPartNames {
  name: string;
  shortName?: string;
}

export interface CatalogPartResult {
  part: Part;
  sounds: Record<string, Sound>;
}

/** Resolve the percussion map represented by a catalog instrument. */
export function effectiveKitFor(
  instrument: CatalogInstrument,
  override?: readonly KitComponentDef[],
): readonly KitComponentDef[] | undefined {
  if (override) return override;
  if (instrument.kit && instrument.kit.length > 0) return instrument.kit;
  if (instrument.unpitchedDrum === undefined) return undefined;
  return [
    {
      id: "hit",
      name: instrument.baseName ?? instrument.name,
      midiNumber: instrument.unpitchedDrum,
      staffPosition: 0,
      ...(instrument.unpitchedDrumNotehead ? { notehead: instrument.unpitchedDrumNotehead } : {}),
    },
  ];
}

/** Names persisted to MNX. Catalog-derived names exclude display-only transposition and numbering. */
export function persistedPartNames(
  instrument: CatalogInstrument,
  names: CatalogPartNames,
  overrides: { name?: boolean; shortName?: boolean } = {},
) {
  return {
    name: overrides.name ? names.name : (instrument.baseName ?? instrument.name),
    shortName: overrides.shortName ? names.shortName : (instrument.baseShortName ?? instrument.shortName),
  };
}

function buildEmptyMeasures(instrument: CatalogInstrument, measureCount: number): Part["measures"] {
  const staves = instrument.staves ?? 1;
  return Array.from({ length: measureCount }, (_, measureIndex) => {
    const measure: Part["measures"][number] = {
      sequences: Array.from({ length: staves }, (_, staffIndex) => ({
        content: [],
        fullMeasure: { visualDuration: { base: "whole" as const } },
        ...(staves > 1 ? { staff: staffIndex + 1 } : {}),
      })),
    };
    if (measureIndex === 0) {
      measure.clefs = Array.from({ length: staves }, (_, staffIndex) => {
        const staff = staffIndex + 1;
        const definition = instrument.clefs[staff];
        if (!definition) return null;
        return {
          clef: {
            sign: definition.sign as ClefSign,
            staffPosition: definition.staffPosition,
            ...(definition.glyph ? { glyph: definition.glyph } : {}),
          },
          ...(staves > 1 ? { staff } : {}),
        };
      }).filter((clef): clef is NonNullable<typeof clef> => clef !== null);
    }
    return measure;
  });
}

function attachKit(
  part: Part,
  instrument: CatalogInstrument,
  partIndex: number,
  override?: readonly KitComponentDef[],
): Record<string, Sound> {
  const definition = effectiveKitFor(instrument, override);
  if (!definition || definition.length === 0) return {};

  const kit: Record<string, KitComponent> = {};
  const sounds: Record<string, Sound> = {};
  for (const component of definition) {
    const soundId = `snd-p${partIndex}-${component.id}`;
    kit[component.id] = {
      name: component.name,
      sound: soundId,
      staffPosition: component.staffPosition,
      ...(component.notehead && component.notehead !== "normal" ? { notehead: component.notehead } : {}),
      ...(component.drumKit !== undefined ? { drumKit: component.drumKit } : {}),
    };
    sounds[soundId] = { midiNumber: component.midiNumber, name: component.name };
  }
  part.kit = kit;
  return sounds;
}

/** Create a catalog-backed empty MNX part and any percussion sounds it references. */
export function createCatalogPart(
  instrument: CatalogInstrument,
  partId: string,
  names: CatalogPartNames,
  measureCount: number,
  partIndex: number,
  kitOverride?: readonly KitComponentDef[],
): CatalogPartResult {
  const staves = instrument.staves ?? 1;
  const part: Part = {
    id: partId,
    name: names.name,
    ...(names.shortName ? { shortName: names.shortName } : {}),
    measures: buildEmptyMeasures(instrument, measureCount),
    ...(staves > 1 ? { staves } : {}),
    ...(instrument.transposition ? { transposition: buildPartTransposition(instrument.transposition) } : {}),
    _x: {
      viritura: {
        instrumentId: instrument.id,
        midiProgram: instrument.midiProgram,
        family: instrument.family,
      },
    },
  };
  const sounds = attachKit(part, instrument, partIndex, kitOverride);
  return { part, sounds };
}
