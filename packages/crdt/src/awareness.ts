/**
 * Awareness payload schema for live collaboration.
 *
 * Per principle #8 in <c>docs/plans/crdt-collaboration.md</c>: identity +
 * cursor + selection + mode, nothing else. Note-input state (current
 * duration, accidental, etc.) stays local.
 */

/** Stable identifier for a collaborator: real user id, or a guest UUID. */
export interface CollaboratorIdentity {
  /** Real user id for signed-in users; ephemeral guest UUID otherwise. */
  readonly userId: string;
  readonly displayName: string;
  /** Deterministic from {@link userId} — see {@link colorForUserId}. */
  readonly color: string;
  readonly isGuest: boolean;
  /** Avatar URL for signed-in users; null for guests. */
  readonly avatarUrl: string | null;
}

/**
 * Caret position. Matches the editor's
 * <c>apps/editor/src/store/noteInputStore.ts</c> <c>CursorPosition</c>
 * shape but is duplicated here so the CRDT package can stand alone.
 */
export interface AwarenessCursor {
  readonly measureIndex: number;
  readonly partIndex: number;
  /** Quarter-note beats from the start of the measure. */
  readonly beatPosition: number;
  readonly staffIndex?: number;
}

export interface AwarenessSelection {
  readonly elementIds: readonly string[];
}

export type AwarenessMode = "normal" | "note-input" | "edit-text" | "playback";

export interface VirituraAwarenessState {
  readonly identity: CollaboratorIdentity;
  readonly cursor?: AwarenessCursor;
  readonly selection?: AwarenessSelection;
  readonly mode: AwarenessMode;
}

/**
 * Perceptually-distinct collaborator color palette. Deterministic hash from
 * the userId so the same user is the same color across all their sessions
 * and across all of their collaborators' clients.
 *
 * Palette chosen to be readable against both light and dark backgrounds.
 * Order is intentional — early hashes get the most readable colors.
 */
const COLLABORATOR_PALETTE: readonly string[] = [
  "#e11d48", // rose
  "#0891b2", // cyan
  "#16a34a", // green
  "#ca8a04", // amber
  "#9333ea", // purple
  "#ea580c", // orange
  "#0284c7", // sky
  "#be185d", // pink
  "#15803d", // emerald
  "#7c3aed", // violet
];

/**
 * Deterministically pick a collaborator color from {@link userId}. Uses a
 * cheap FNV-1a hash — quality is fine for a 10-bucket palette and we avoid
 * pulling in crypto for a non-security use case.
 */
export function colorForUserId(userId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const index = Math.abs(hash) % COLLABORATOR_PALETTE.length;
  return COLLABORATOR_PALETTE[index]!;
}
