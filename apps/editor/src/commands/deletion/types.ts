import type { Score } from "@viritura/core";
import type { SelectableElementType } from "../../score/elementTypes";

export interface DeletionContext {
  scoreIndex: number;
  forceDirect: boolean;
}

export type DeletionTargetKind = SelectableElementType | "segno" | "coda" | "fine";

export interface DeletionTarget {
  kind: DeletionTargetKind;
  elementId: string;
}

export type DeletionOperation =
  | { kind: "event" }
  | { kind: "leaf"; remove: (score: Score, elementId: string, context: DeletionContext) => Score | null }
  | { kind: "unsupported"; reason: string };
