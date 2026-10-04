import type { StaffTextFramePresentation } from "@viritura/core";
import { staffTextFramePresentation as validate } from "./standaloneValidators";

export function parseStaffTextFramePresentation(raw: unknown): StaffTextFramePresentation {
  if (!validate(raw)) throw new Error("MNX: expressions[].frame: invalid staff text frame presentation");
  const frame = raw as StaffTextFramePresentation;
  if (
    (frame.width !== undefined && !Number.isFinite(frame.width.value)) ||
    (frame.padding !== undefined && !Number.isFinite(frame.padding))
  ) {
    throw new Error("MNX: expressions[].frame: dimensions must be finite");
  }
  return { ...frame, ...(frame.width ? { width: { ...frame.width } } : {}) };
}
