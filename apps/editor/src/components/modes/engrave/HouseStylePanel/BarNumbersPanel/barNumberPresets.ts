import {
  DEFAULT_BAR_NUMBER_SETTINGS,
  DEFAULT_TEXT_STYLES,
  pointsToStaffSpaces,
  resolveScorePageSetup,
  type BarNumberSettings,
  type BarNumberTextStyle,
  type Score,
} from "@viritura/core";
import { bracketPlacements } from "./bracketPlacements";
import { updateBarNumberStyle } from "./barNumberStyle";

export type BarNumberPreset = "classical" | "film";

function filmPlacement(score: Score, scoreIndex: number): Pick<BarNumberSettings, "placements" | "aboveGroups"> {
  const strings = bracketPlacements(score, scoreIndex).find(
    (group) =>
      /\bstrings\b/i.test(group.label) ||
      group.parts.every((id) => {
        const part = score.parts.find((entry) => entry.id === id);
        return (
          part?._x?.viritura?.family === "strings" ||
          part?._x?.viritura?.instrumentId?.startsWith("strings.") ||
          /\b(violin|viola|cello|violoncello|contrabass|double bass|strings)\b/i.test(part?.name ?? "")
        );
      }),
  );
  return strings ? { placements: [], aboveGroups: [strings.parts] } : { placements: ["belowSystem"], aboveGroups: [] };
}

/** Apply a preset at the chosen scope without discarding existing layout overrides. */
export function applyBarNumberPreset(
  score: Score,
  scoreIndex: number,
  scope: "document" | "layout",
  preset: BarNumberPreset,
): Score {
  const settings: BarNumberSettings = {
    ...DEFAULT_BAR_NUMBER_SETTINGS,
    placements: ["belowSystem"],
    aboveGroups: [],
    ...(preset === "film"
      ? {
          frequency: "everyBar",
          showFirst: true,
          onStaff: true,
          showStaffLine: true,
          horizontalAlignment: "center",
          enclosure: "box",
        }
      : {}),
  };
  const { size, family, bold, italic } = DEFAULT_TEXT_STYLES.barNumber!;
  const style: Required<BarNumberTextStyle> =
    preset === "film"
      ? {
          family,
          size: pointsToStaffSpaces(8, resolveScorePageSetup(score, scoreIndex).spatiumMm),
          bold: true,
          italic: false,
        }
      : { size, family, bold, italic };
  if (scope === "layout") {
    const view = score.scores?.[scoreIndex];
    if (!view) throw new Error("Select a score layout before applying a bar-number preset.");
    const scores = [...score.scores!];
    scores[scoreIndex] = {
      ...view,
      barNumbers: { ...settings, ...(preset === "film" ? filmPlacement(score, scoreIndex) : {}), style },
    };
    return { ...score, scores };
  }
  const next = updateBarNumberStyle({ ...score, barNumbers: settings }, scoreIndex, "document", style);
  if (!score.scores || preset === "classical") return next;
  return {
    ...next,
    scores: score.scores.map((view, index) => {
      const stored = view.barNumbers;
      if (stored?.placement !== undefined || stored?.placements !== undefined || stored?.aboveGroups !== undefined) {
        return view;
      }
      const placement = filmPlacement(score, index);
      if (!placement.aboveGroups?.length) return view;
      return { ...view, barNumbers: { ...stored, ...placement } };
    }),
  };
}
