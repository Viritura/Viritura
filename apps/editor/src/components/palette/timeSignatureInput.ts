import { defaultBeatStructure, type TimeSignature } from "@viritura/core";

export const TIME_SIGNATURE_UNITS = [1, 2, 4, 8, 16, 32, 64, 128] as const;

const TIME_SIGNATURE_RE = /^(\d{1,3})\s*\/\s*(\d{1,3})(?:\s+(.+))?$/;

export type TimeSignatureInputResult =
  | {
      time: TimeSignature;
      error: null;
      enteredBeatStructure?: number[];
    }
  | {
      time: null;
      error: string;
    };

function sameGroups(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

type BeatStructureResult = { groups: number[]; error: null } | { groups: null; error: string };

function parseBeatStructure(input: string, count: number): BeatStructureResult {
  const hasPlus = input.includes("+");
  const hasComma = input.includes(",");
  if (hasPlus && hasComma) {
    return { groups: null, error: "Use either + or , between beat groups, not both" };
  }

  let groups: number[];
  if (hasPlus || hasComma) {
    const delimiter = hasPlus ? "+" : ",";
    const pattern = hasPlus ? /^\d{1,3}(?:\s*\+\s*\d{1,3})+$/ : /^\d{1,3}(?:\s*,\s*\d{1,3})+$/;
    if (!pattern.test(input)) {
      return { groups: null, error: "Enter positive beat groups separated by + or ," };
    }
    groups = input.split(delimiter).map((group) => Number(group.trim()));
  } else {
    if (!/^\d+$/.test(input)) {
      return { groups: null, error: "Enter beat groups as digits or separate them with + or ," };
    }
    groups = [...input].map(Number);
  }

  if (groups.some((group) => group <= 0)) {
    return { groups: null, error: "Beat groups must be positive integers" };
  }
  const total = groups.reduce((sum, group) => sum + group, 0);
  if (total !== count) {
    return { groups: null, error: `Beat groups total ${total}, but the meter numerator is ${count}` };
  }

  return { groups, error: null };
}

export function parseTimeSignatureInputWithError(input: string): TimeSignatureInputResult {
  const match = TIME_SIGNATURE_RE.exec(input.trim());
  if (!match) {
    return {
      time: null,
      error: "Use n/d, optionally followed by grouping such as 5/8 32 or 5/8 3+2",
    };
  }

  const count = Number(match[1]!);
  const unit = Number(match[2]!);
  if (count < 1 || count > 999) return { time: null, error: "The meter numerator must be from 1 to 999" };
  if (!TIME_SIGNATURE_UNITS.some((allowed) => allowed === unit)) {
    return { time: null, error: "Use denominator 1, 2, 4, 8, 16, 32, 64, or 128" };
  }

  const groupingInput = match[3]?.trim();
  if (!groupingInput) return { time: { count, unit }, error: null };

  const parsedGrouping = parseBeatStructure(groupingInput, count);
  if (!parsedGrouping.groups) return { time: null, error: parsedGrouping.error };
  const groups = parsedGrouping.groups;
  const defaults = defaultBeatStructure(count, unit);
  return {
    time: {
      count,
      unit,
      ...(sameGroups(groups, defaults) ? {} : { beatStructure: groups }),
    },
    error: null,
    enteredBeatStructure: groups,
  };
}

export function parseTimeSignatureInput(input: string): TimeSignature | null {
  return parseTimeSignatureInputWithError(input).time;
}
