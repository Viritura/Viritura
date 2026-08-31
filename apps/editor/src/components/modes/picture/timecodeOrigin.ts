/**
 * Structured SMPTE origin fields.
 *
 * Origin is configuration, not a search box: hours, minutes, seconds and frames
 * each have a known range, and drop-frame timecode has labels that do not exist.
 * Keeping those rules here makes the segmented editor small and testable.
 */

import { formatFrameTimecode, parseTimecodeSeconds, type FrameRateSpec } from "@viritura/video-sync";

export type OriginField = "hours" | "minutes" | "seconds" | "frames";

export interface OriginFieldValues {
  readonly hours: string;
  readonly minutes: string;
  readonly seconds: string;
  readonly frames: string;
}

export const ORIGIN_FIELDS: readonly OriginField[] = ["hours", "minutes", "seconds", "frames"];

export function originFieldsFromFrame(frame: number, rate: FrameRateSpec): OriginFieldValues {
  const text = formatFrameTimecode(frame, rate);
  const parts = text.replace(";", ":").split(":");
  return {
    hours: parts[0]?.padStart(2, "0") ?? "00",
    minutes: parts[1]?.padStart(2, "0") ?? "00",
    seconds: parts[2]?.padStart(2, "0") ?? "00",
    frames: parts[3]?.padStart(2, "0") ?? "00",
  };
}

export function originSecondsFromFields(fields: OriginFieldValues, rate: FrameRateSpec): number | null {
  if (!fieldsAreComplete(fields)) return null;
  const hours = Number(fields.hours);
  const minutes = Number(fields.minutes);
  const seconds = Number(fields.seconds);
  const frames = Number(fields.frames);
  const maximumFrame = Math.round(rate.numerator / rate.denominator) - 1;
  if (
    !Number.isInteger(hours) ||
    hours < 0 ||
    hours > 23 ||
    !Number.isInteger(minutes) ||
    minutes < 0 ||
    minutes > 59 ||
    !Number.isInteger(seconds) ||
    seconds < 0 ||
    seconds > 59 ||
    !Number.isInteger(frames) ||
    frames < 0 ||
    frames > maximumFrame
  ) {
    return null;
  }
  const separator = rate.dropFrame ? ";" : ":";
  return parseTimecodeSeconds(`${fields.hours}:${fields.minutes}:${fields.seconds}${separator}${fields.frames}`, rate);
}

export function sanitizeOriginField(value: string): string {
  return value.replace(/\D/g, "").slice(0, 2);
}

export function stepOriginField(
  fields: OriginFieldValues,
  field: OriginField,
  delta: number,
  rate: FrameRateSpec,
): OriginFieldValues {
  const maximum = field === "hours" ? 23 : field === "frames" ? Math.round(rate.numerator / rate.denominator) - 1 : 59;
  const current = Number(fields[field]) || 0;
  const range = maximum + 1;
  const next = (((current + delta) % range) + range) % range;
  return { ...fields, [field]: String(next).padStart(2, "0") };
}

export function originPreset(hours: number): OriginFieldValues {
  return {
    hours: String(hours).padStart(2, "0"),
    minutes: "00",
    seconds: "00",
    frames: "00",
  };
}

function fieldsAreComplete(fields: OriginFieldValues): boolean {
  return ORIGIN_FIELDS.every((field) => fields[field].length > 0);
}
