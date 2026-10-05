import type { StaffTextFramePresentation, TextFramePagePosition } from "@viritura/core";
import {
  staffTextFramePresentation as validate,
  textFramePagePosition as validatePagePosition,
} from "./standaloneValidators";

export function parseTextFramePagePosition(raw: unknown): TextFramePagePosition {
  if (!validatePagePosition(raw)) throw new Error("MNX: expressions[].pagePosition: invalid page geometry");
  const position = raw as TextFramePagePosition;
  if (
    !Number.isFinite(position.width.value) ||
    !Number.isFinite(position.placement.offset.x) ||
    !Number.isFinite(position.placement.offset.y)
  ) {
    throw new Error("MNX: expressions[].pagePosition: dimensions must be finite");
  }
  return position;
}

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
