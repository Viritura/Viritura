/**
 * useHostPresenceWatcher — guest-side safety net for host disconnects.
 *
 * The canonical MNX state for a live room lives on the host's machine.
 * When the host leaves the room (closed tab, lost network, crashed), the
 * room's authoritative source vanishes, even though the Y.Doc state is
 * replicated to every connected guest. Letting guests keep editing each
 * other's replicas would produce divergent forks the moment the host
 * tried to rejoin — there is no merge story for the Y.Text-as-canonical
 * bridge, and even after the per-element CRDT migration the social
 * contract "<c>this is the host's score</c>" should be enforced rather
 * than silently violated.
 *
 * So: every peer watches the awareness peer set. The doc's <c>_meta</c>
 * map carries <c>hostClientId</c> — written atomically with the initial
 * seed in {@link useLiveBridge}. If the host's clientID disappears from
 * the awareness peer set, every other peer:
 *
 *  1. stops the live session ({@link useLiveSessionStore.stopLive}),
 *  2. surfaces a toast so the user understands why their collaborators
 *     just vanished from the chip strip.
 *
 * The local host (whose own clientID matches the meta record) does
 * NOT trigger the kick on themselves — they are the host.
 *
 * **Grace period.** A short (1.5s) settling window absorbs transient
 * disconnects from awareness churn (tab visibility flips, brief WebRTC
 * renegotiation) so users don't get bounced over a momentary blip.
 */

import { useEffect } from "react";
import { toast } from "sonner";
import { useLiveSessionStore } from "./liveSessionStore";

/** ms to wait before treating an absent host clientID as a real disconnect. */
const HOST_GRACE_PERIOD_MS = 1500;

export function useHostPresenceWatcher(): void {
  const session = useLiveSessionStore((s) => s.session);
  const stopLive = useLiveSessionStore((s) => s.stopLive);

  useEffect(() => {
    if (!session) return;
    const { bridge, awareness, doc } = session;
    if (!awareness) return;

    let pendingKickTimer: ReturnType<typeof setTimeout> | null = null;

    const evaluate = (): void => {
      const hostClientId = bridge.getHostClientId();
      // No host claim recorded yet — seed-arbitration hasn't completed.
      // The kick logic only applies after a host is established.
      if (hostClientId === null) return;
      // I am the host; nothing to watch for.
      if (hostClientId === doc.clientID) return;
      // Host clientID is in the awareness peer set → host is present.
      if (awareness.getStates().has(hostClientId)) {
        if (pendingKickTimer !== null) {
          clearTimeout(pendingKickTimer);
          pendingKickTimer = null;
        }
        return;
      }
      // Host is absent. Start (or extend) the grace timer.
      if (pendingKickTimer !== null) return;
      pendingKickTimer = setTimeout(() => {
        pendingKickTimer = null;
        // Re-check inside the timeout — the host may have reconnected
        // during the grace window.
        if (awareness.getStates().has(hostClientId)) return;
        toast.warning("Live session ended", {
          description: "The host left the room. You've been disconnected from the live session.",
        });
        stopLive();
      }, HOST_GRACE_PERIOD_MS);
    };

    // Evaluate on awareness change (peer joined / left / updated state)
    // AND on host-claim change (the meta map's hostClientId was just
    // written for the first time — relevant for late-joining guests).
    awareness.on("change", evaluate);
    const unsubHost = bridge.onHostClaimChange(evaluate);
    evaluate();

    return () => {
      if (pendingKickTimer !== null) clearTimeout(pendingKickTimer);
      awareness.off("change", evaluate);
      unsubHost();
    };
  }, [session, stopLive]);
}
