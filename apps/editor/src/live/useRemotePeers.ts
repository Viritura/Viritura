/**
 * useRemotePeers — returns the typed awareness payloads of all peers
 * currently visible on the live-session channel **except** the local
 * client. Re-renders the caller whenever awareness changes for any peer.
 */

import { useEffect, useState } from "react";
import type { VirituraAwarenessState } from "@viritura/crdt";
import { useLiveSessionStore } from "./liveSessionStore";

export interface RemotePeer {
  readonly clientId: number;
  readonly state: VirituraAwarenessState;
}

export function useRemotePeers(): readonly RemotePeer[] {
  const session = useLiveSessionStore((s) => s.session);
  const [peers, setPeers] = useState<readonly RemotePeer[]>([]);

  useEffect(() => {
    if (!session || !session.awareness) {
      setPeers([]);
      return;
    }
    const { awareness } = session;
    const refresh = (): void => {
      const localId = awareness.clientID;
      const next: RemotePeer[] = [];
      session.getPeers().forEach((state, clientId) => {
        if (clientId === localId) return;
        next.push({ clientId, state });
      });
      setPeers(next);
    };
    refresh();
    awareness.on("change", refresh);
    return () => {
      awareness.off("change", refresh);
    };
  }, [session]);

  return peers;
}
