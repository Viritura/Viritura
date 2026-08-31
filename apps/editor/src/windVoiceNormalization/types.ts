import type { Note } from "@viritura/core";

export interface WindVoiceConflict {
  readonly partId: string;
  readonly measure: number;
  readonly eventId: string | null;
  readonly noteIds: readonly (string | null)[];
  readonly pitches: readonly string[];
}

export interface WindVoiceNormalizationResult<ScoreType> {
  readonly score: ScoreType;
  readonly conflicts: readonly WindVoiceConflict[];
}

export interface TimedNoteEvent {
  readonly onset: number;
  readonly duration: number;
  readonly event: {
    id?: string;
    notes?: Note[];
    rest?: { staffPosition?: number };
  };
}
