import { getCatalogInstrument } from "../../../score/InstrumentCatalog";
import { soundingPitchLabel } from "./pitch";

interface TranspositionPitchPreset {
  id: string;
  label: string;
  halfSteps: number;
  staffDistance: number;
}

const HORN_PRESETS: readonly TranspositionPitchPreset[] = [
  { id: "horn-f", label: "Horn in F", halfSteps: 7, staffDistance: 4 },
  { id: "horn-e", label: "Horn in E", halfSteps: 8, staffDistance: 5 },
  { id: "horn-eb", label: "Horn in E♭", halfSteps: 9, staffDistance: 5 },
  { id: "horn-d", label: "Horn in D", halfSteps: 10, staffDistance: 6 },
  { id: "horn-c", label: "Horn in C (alto)", halfSteps: 0, staffDistance: 0 },
  { id: "horn-bb-alto", label: "Horn in B♭ (alto)", halfSteps: 2, staffDistance: 1 },
  { id: "horn-bb-basso", label: "Horn in B♭ (basso)", halfSteps: 14, staffDistance: 8 },
  { id: "horn-a", label: "Horn in A", halfSteps: 3, staffDistance: 2 },
  { id: "horn-g", label: "Horn in G", halfSteps: 5, staffDistance: 3 },
];

const CLARINET_PRESETS: readonly TranspositionPitchPreset[] = [
  { id: "clarinet-bb", label: "Soprano clarinet in B♭", halfSteps: 2, staffDistance: 1 },
  { id: "clarinet-a", label: "Clarinet in A", halfSteps: 3, staffDistance: 2 },
  { id: "clarinet-c", label: "Clarinet in C", halfSteps: 0, staffDistance: 0 },
  { id: "clarinet-d", label: "Piccolo clarinet in D", halfSteps: -2, staffDistance: -1 },
  { id: "clarinet-eb-piccolo", label: "Piccolo clarinet in E♭", halfSteps: -3, staffDistance: -2 },
  { id: "clarinet-eb-alto", label: "Alto clarinet in E♭", halfSteps: 9, staffDistance: 5 },
  { id: "clarinet-f", label: "Basset horn in F", halfSteps: 7, staffDistance: 4 },
  { id: "clarinet-bb-bass", label: "Bass clarinet in B♭", halfSteps: 14, staffDistance: 8 },
  { id: "clarinet-eb-contra", label: "Contra-alto clarinet in E♭", halfSteps: 21, staffDistance: 12 },
  { id: "clarinet-bb-contra", label: "Contrabass clarinet in B♭", halfSteps: 26, staffDistance: 15 },
];

/** Presets change notation only, never the selected instrument or its sound. */
export function transpositionPitchPresets(instrumentId?: string): TranspositionPitchPreset[] {
  const instrument = instrumentId ? getCatalogInstrument(instrumentId) : undefined;
  const presets: TranspositionPitchPreset[] = [];
  if (instrument) {
    const interval = instrument.transposition;
    presets.push({
      id: "catalog-default",
      label: `Instrument default — ${instrument.name}`,
      halfSteps: interval?.halfSteps ?? 0,
      staffDistance: interval?.staffDistance ?? 0,
    });
  }
  if (instrumentId === "brass.french-horn" || instrumentId?.startsWith("brass.french-horn.")) {
    presets.push(...HORN_PRESETS);
  } else if (instrumentId?.startsWith("wind.reed.clarinet")) {
    presets.push(...CLARINET_PRESETS);
  }
  presets.push({ id: "concert", label: "Concert pitch", halfSteps: 0, staffDistance: 0 });
  return presets.map((preset) => ({
    ...preset,
    label: `${preset.label} — ${soundingPitchLabel(preset.halfSteps, preset.staffDistance)}`,
  }));
}
