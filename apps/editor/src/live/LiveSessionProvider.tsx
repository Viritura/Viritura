/**
 * LiveSessionProvider — top-level integration component.
 *
 * Responsibilities:
 *  - Resolve the local collaborator identity (signed-in user → real
 *    identity; otherwise a guest profile derived from stored name +
 *    persistent guest UUID).
 *  - Auto-start a live session if the page was loaded with
 *    <c>?live=ROOMID</c> in the URL.
 *  - Run the document-store ↔ Y.Doc bridge.
 *  - Run the local cursor → awareness broadcast.
 *  - Stop the session on unmount and on navigation away from the live URL.
 *
 * Renders no UI itself. Pair with {@link CollaboratorPresence} and
 * {@link LiveActivityButton} for the visible affordances.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { CollaboratorIdentity } from "@viritura/crdt";
import { PromptDialog } from "@viritura/ui";
import { useVirituraAccount } from "../auth/useVirituraAccount";
import {
  buildAuthenticatedIdentity,
  buildGuestIdentity,
  getStoredGuestName,
  setStoredGuestName,
  subscribeStoredGuestName,
} from "./identity";
import { useLiveSessionStore } from "./liveSessionStore";
import { useLiveBridge } from "./useLiveBridge";
import { useLocalCursorBroadcast } from "./useLocalCursorBroadcast";
import { useHostPresenceWatcher } from "./useHostPresenceWatcher";
import { parseLiveRoomIdFromUrl, parseLiveSignalingFromUrl, parseLiveTransportFromUrl } from "./liveUrl";

/**
 * Hook returning the local user's resolved collaborator identity. Returns
 * <c>null</c> while the auth status is still loading, and also while an
 * unauthenticated guest who arrived via a <c>?live=ROOMID</c> share link
 * still needs to supply a display name (the {@link LiveSessionProvider}
 * renders a prompt dialog for that case).
 *
 * The hook subscribes to {@link subscribeStoredGuestName} so React
 * re-derives the identity the moment the prompt persists a name — no
 * polling, no <c>storage</c>-event hack (which only fires cross-tab).
 */
// eslint-disable-next-line react-refresh/only-export-components -- intentional colocation: the LiveSessionProvider component and useLocalIdentity hook are a tight unit that always ship together; splitting would fork the import for every consumer with no architectural benefit.
export function useLocalIdentity(): CollaboratorIdentity | null {
  const { user, status } = useVirituraAccount();
  const storedGuestName = useSyncExternalStore(
    subscribeStoredGuestName,
    getStoredGuestName,
    () => null, // SSR: no localStorage, assume no name
  );
  return useMemo(() => {
    if (status === "loading") return null;
    if (user) return buildAuthenticatedIdentity(user);
    // Anonymous guest. If they arrived via a share link and haven't
    // picked a display name yet, withhold identity so the provider's
    // prompt dialog can gate the auto-join.
    if (!storedGuestName && parseLiveRoomIdFromUrl() !== null) return null;
    return buildGuestIdentity(storedGuestName ?? "Guest");
  }, [user, status, storedGuestName]);
}

export interface LiveSessionProviderProps {
  /**
   * Optional stable score id used to partition IndexedDB persistence per
   * open document. When undefined the session uses no local persistence
   * (suitable for unsaved or fresh-load scores).
   */
  readonly scoreId?: string;
}

export function LiveSessionProvider({ scoreId }: LiveSessionProviderProps) {
  const identity = useLocalIdentity();
  const { user, status: authStatus } = useVirituraAccount();
  const startLive = useLiveSessionStore((s) => s.startLive);
  const status = useLiveSessionStore((s) => s.status);

  // The prompt is open when an anonymous guest has landed on a share
  // link and hasn't picked a display name yet. We re-evaluate per render
  // — the URL doesn't change without a navigation, so this is cheap and
  // also self-closes the moment {@link setStoredGuestName} fires.
  const needsGuestNamePrompt = useSyncExternalStore(
    subscribeStoredGuestName,
    () => authStatus === "ready" && !user && getStoredGuestName() === null && parseLiveRoomIdFromUrl() !== null,
    () => false,
  );

  const handleGuestNameSubmit = useCallback((name: string) => {
    const trimmed = name.trim();
    // PromptDialog's allowEmpty defaults to true; we only persist real
    // input. If the user somehow submitted empty, fall back to "Guest"
    // so they aren't stuck in a prompt loop.
    setStoredGuestName(trimmed.length > 0 ? trimmed : "Guest");
  }, []);

  // Auto-join from URL once identity is resolved. We deliberately allow
  // joining with an empty local document: the boot sequence skips both
  // the Start Center and the default-score load when it detects a
  // `?live=` URL (see useBootSequence), and the bridge's seed branch
  // for `localMnx.length === 0` waits for remote content instead of
  // pushing local. So an empty local + active session is the correct
  // pull-down path for a guest.
  //
  // For host-initiated joins (clicked "Start live session" inside an
  // already-loaded score) the document is non-empty by construction, so
  // this condition is also satisfied there.
  //
  // NOTE: idempotency is achieved by re-reading `status` from the store
  // on every render — when a session is already `"active"` we bail out
  // synchronously. We deliberately do NOT use a `useRef` "already tried"
  // guard here: refs survive React 19 StrictMode's mount→cleanup→
  // re-mount cycle, but the session itself does not (we used to call
  // `stopLive()` from an unmount-cleanup effect). The combination
  // produced a dev-only race where the second mount saw the ref set,
  // bailed out, and never recreated the session — leaving both peers
  // stranded with no awareness exchange.
  //
  // We also no longer call `stopLive()` on unmount. The session lives
  // in a Zustand singleton; its lifetime is "from auto-join (or Start)
  // until the user clicks Leave / closes the tab", not "from
  // LiveSessionProvider mount until unmount". Tying it to component
  // lifecycle was the other half of the StrictMode bug.
  useEffect(() => {
    if (!identity) return;
    if (status === "active" || status === "starting") return;
    const urlRoomId = parseLiveRoomIdFromUrl();
    if (!urlRoomId) return;
    try {
      const transport = parseLiveTransportFromUrl() ?? undefined;
      const signalingUrls = parseLiveSignalingFromUrl() ?? undefined;
      startLive({ roomId: urlRoomId, identity, scoreId, transport, signalingUrls });
    } catch (err) {
      console.warn("[live] auto-join failed:", err);
    }
  }, [identity, status, startLive, scoreId]);

  // Always-on bridges (no-op when no session is active).
  useLiveBridge();
  useLocalCursorBroadcast(identity);
  useHostPresenceWatcher();

  // E2E diagnostics: expose the local clientID and the bridge-recorded
  // host clientID on a debug handle so the live-collaboration E2E test
  // can identify which page is the host and close it. Strictly read-only
  // and side-effect-free; gated to non-production builds.
  const session = useLiveSessionStore((s) => s.session);
  useEffect(() => {
    if (import.meta.env.PROD) return;
    if (!session) {
      delete (window as unknown as { __virituraLive?: unknown }).__virituraLive;
      return;
    }
    const { doc, bridge } = session;
    const update = (): void => {
      (
        window as unknown as {
          __virituraLive?: {
            clientID: number;
            hostClientId: number | null;
            seed: (mnxJson: string) => void;
          };
        }
      ).__virituraLive = {
        clientID: doc.clientID,
        hostClientId: bridge.getHostClientId(),
        // Test seam: lets the live-collaboration E2E push initial MNX
        // into the room and claim host. Normal "host" flow seeds via
        // the boot sequence's default-score load, but the E2E opens
        // both peers with `?live=`, which intentionally skips that
        // load (see useBootSequence), so the test needs an explicit
        // way to install a host.
        seed: (mnxJson: string) => bridge.setMnxJson(mnxJson, { claimHost: true }),
      };
    };
    update();
    const off = bridge.onHostClaimChange(update);
    return () => {
      off();
      delete (window as unknown as { __virituraLive?: unknown }).__virituraLive;
    };
  }, [session]);

  return (
    <PromptDialog
      open={needsGuestNamePrompt}
      onClose={() => {
        // Backdrop / Escape / Cancel — treat as "join with the
        // throwaway 'Guest' name" rather than stranding the user on a
        // half-loaded editor with no way out.
        setStoredGuestName("Guest");
      }}
      onSubmit={handleGuestNameSubmit}
      title="Join the live session"
      description="Pick a display name so collaborators can see who's editing."
      label="Display name"
      placeholder="Your name"
      confirmLabel="Join"
      allowEmpty={false}
    />
  );
}
