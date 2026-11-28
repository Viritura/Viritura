import { PAGE_SIZE_PRESETS, RASTRAL_SPATIUM_MM, type PageSetupDefaults, type Score } from "@viritura/core";
import { applyBarNumberPreset } from "../components/modes/engrave/HouseStylePanel/BarNumbersPanel";
import { setSettings, settingsForPreset } from "../components/modes/engrave/HouseStylePanel/TimeSignatureAppearance";
import { produce } from "../score/scoreClone";

export type HouseStylePresetId = "classical" | "film";

export interface HouseStylePreset {
  id: HouseStylePresetId;
  label: string;
  description: string;
}

export const HOUSE_STYLE_PRESETS: readonly HouseStylePreset[] = [
  {
    id: "classical",
    label: "Classical",
    description: "A4 scores and parts, bar numbers at the start of each system, standard time signatures.",
  },
  {
    id: "film",
    label: "Film",
    description:
      "Tabloid conductor scores, Letter parts, boxed bar numbers on every bar, large time signatures in the score.",
  },
];

const TABLOID = PAGE_SIZE_PRESETS["Tabloid"]!;
const LETTER = PAGE_SIZE_PRESETS["Letter"]!;

const PAGE_DEFAULTS: Record<HouseStylePresetId, PageSetupDefaults | undefined> = {
  classical: undefined,
  film: {
    score: {
      width: TABLOID.width,
      height: TABLOID.height,
      orientation: "portrait",
      margins: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
      spatiumMm: RASTRAL_SPATIUM_MM[7]!,
    },
    part: {
      width: LETTER.width,
      height: LETTER.height,
      orientation: "portrait",
      margins: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
    },
  },
};

/**
 * Replace the house style with a preset: default score and part profiles, bar numbers, and time signatures.
 * Named profiles and each layout's own overrides are kept.
 */
export function applyHouseStylePreset(score: Score, id: HouseStylePresetId, scoreIndex: number): Score {
  const pageDefaults = PAGE_DEFAULTS[id];
  const withPages = produce(score, (draft) => {
    if (pageDefaults) draft.pageSetupDefaults = structuredClone(pageDefaults);
    else delete draft.pageSetupDefaults;
  });
  const withNumbers = applyBarNumberPreset(withPages, scoreIndex, "document", id);
  const timeSignatures = id === "film" ? setSettings(undefined, "score", settingsForPreset("filmScore")!) : undefined;
  return {
    ...withNumbers,
    timeSignatures: timeSignatures && Object.keys(timeSignatures).length ? timeSignatures : undefined,
  };
}
