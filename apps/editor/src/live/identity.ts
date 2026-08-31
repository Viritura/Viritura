/**
 * Live-collaboration identity. Returns a stable {@link CollaboratorIdentity}
 * for the current user — backed by the signed-in <c>VirituraUser</c> when
 * present, or a per-tab persisted guest profile otherwise.
 *
 * Guest profile rules (per <c>docs/plans/crdt-collaboration.md</c> D1):
 *  - Guest id is a UUID minted on first visit and kept in <c>localStorage</c>
 *    so the same browser keeps the same color across reloads/sessions.
 *  - Guest display name is kept in <c>localStorage</c> too; when missing the
 *    join flow prompts the user to pick one before publishing presence.
 */

import { colorForUserId, type CollaboratorIdentity } from "@viritura/crdt";
import type { VirituraUser } from "../auth/api";

const GUEST_ID_STORAGE_KEY = "viritura.live.guestId";
const GUEST_NAME_STORAGE_KEY = "viritura.live.guestName";

/**
 * Listeners notified whenever {@link setStoredGuestName} writes a new
 * value. Enables React consumers to re-derive their identity via
 * <c>useSyncExternalStore</c> without polling or relying on the browser's
 * <c>storage</c> event (which only fires cross-tab, not same-tab).
 */
const guestNameListeners = new Set<() => void>();

/**
 * Subscribe to guest-name changes for the lifetime of the returned
 * unsubscribe function. Use with {@link getStoredGuestName} in
 * <c>useSyncExternalStore</c>.
 */
export function subscribeStoredGuestName(listener: () => void): () => void {
  guestNameListeners.add(listener);
  return () => {
    guestNameListeners.delete(listener);
  };
}

export function buildAuthenticatedIdentity(user: VirituraUser): CollaboratorIdentity {
  const displayName = user.displayName?.trim() || user.email;
  return {
    userId: user.id,
    displayName,
    color: colorForUserId(user.id),
    isGuest: false,
    avatarUrl: user.avatarUrl,
  };
}

/**
 * Get or create a stable guest user id for this browser. Falls back to a
 * fresh UUID when <c>localStorage</c> is unavailable (private windows on
 * some browsers).
 */
function getOrCreateGuestId(): string {
  try {
    const existing = localStorage.getItem(GUEST_ID_STORAGE_KEY);
    if (existing && existing.length > 0) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(GUEST_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

/** Read the cached guest display name, if any. */
export function getStoredGuestName(): string | null {
  try {
    const stored = localStorage.getItem(GUEST_NAME_STORAGE_KEY);
    return stored && stored.trim().length > 0 ? stored.trim() : null;
  } catch {
    return null;
  }
}

/** Persist the chosen guest display name. */
export function setStoredGuestName(name: string): void {
  try {
    localStorage.setItem(GUEST_NAME_STORAGE_KEY, name.trim());
  } catch {
    /* localStorage unavailable — name will only last this session */
  }
  for (const listener of guestNameListeners) listener();
}

/**
 * Build a guest identity given the user's chosen display name. The caller
 * is responsible for sourcing that name from {@link getStoredGuestName} or
 * the join prompt.
 */
export function buildGuestIdentity(displayName: string): CollaboratorIdentity {
  const userId = getOrCreateGuestId();
  return {
    userId,
    displayName: displayName.trim() || "Guest",
    color: colorForUserId(userId),
    isGuest: true,
    avatarUrl: null,
  };
}
