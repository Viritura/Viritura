/**
 * BroadcastChannel transport for Y.Doc + awareness.
 *
 * Pipes Yjs update messages and awareness state between Y.Doc instances
 * running in different tabs of the same browser (same origin). Useful for:
 *
 *  1. **Multi-tab single-user sync** — a user with the score open in two
 *     tabs should see edits reflected immediately, with no network.
 *  2. **Deterministic E2E tests** — Playwright can verify the full Y.Doc
 *     ↔ bridge ↔ awareness ↔ remote-cursor-overlay pipeline using two
 *     pages in one browser context, without depending on external
 *     signaling servers (which have historically been flaky for
 *     <c>y-webrtc</c>'s public fallbacks).
 *
 * Wire format (JSON over <c>BroadcastChannel</c>):
 *   <c>{ kind: "doc", clientId, update: number[] }</c> — Yjs update bytes
 *   <c>{ kind: "aware-update", clientId, update: number[] }</c> — awareness encoder bytes
 *   <c>{ kind: "aware-query", clientId }</c> — request full state from peers
 *
 * Limitations:
 *  - Same-origin only (BroadcastChannel constraint).
 *  - Does NOT use WebRTC; cannot cross machines. Pair with
 *    <c>WebrtcProvider</c> for real collaboration.
 */

import type * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";

const DOC_KIND = "doc";
const DOC_QUERY_KIND = "doc-query";
const AWARE_UPDATE_KIND = "aware-update";
const AWARE_QUERY_KIND = "aware-query";

interface DocMessage {
  readonly kind: typeof DOC_KIND;
  readonly clientId: number;
  readonly update: number[];
}
interface DocQueryMessage {
  readonly kind: typeof DOC_QUERY_KIND;
  readonly clientId: number;
}
interface AwareUpdateMessage {
  readonly kind: typeof AWARE_UPDATE_KIND;
  readonly clientId: number;
  readonly update: number[];
}
interface AwareQueryMessage {
  readonly kind: typeof AWARE_QUERY_KIND;
  readonly clientId: number;
}
type ChannelMessage = DocMessage | DocQueryMessage | AwareUpdateMessage | AwareQueryMessage;

export interface BroadcastChannelProvider {
  readonly awareness: Awareness;
  destroy(): void;
}

/**
 * Attach a BroadcastChannel transport to a Y.Doc. Returns an awareness
 * object that's wired through the same channel.
 *
 * Origin tag: incoming updates are applied with the string
 * <c>"broadcast-channel"</c> as the transaction origin, so callers that
 * want to distinguish local vs. remote can filter on it.
 */
export function attachBroadcastChannelProvider(channelName: string, doc: Y.Doc): BroadcastChannelProvider {
  const channel = new BroadcastChannel(channelName);
  const awareness = new Awareness(doc);
  const clientId = doc.clientID;

  // ── Outgoing: Y.Doc updates ──
  const docUpdateHandler = (update: Uint8Array, origin: unknown): void => {
    if (origin === "broadcast-channel") return; // don't echo
    const msg: DocMessage = { kind: DOC_KIND, clientId, update: Array.from(update) };
    channel.postMessage(msg);
  };
  doc.on("update", docUpdateHandler);

  // ── Outgoing: awareness updates ──
  const awarenessUpdateHandler = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }): void => {
    const changedClients = added.concat(updated).concat(removed);
    if (changedClients.length === 0) return;
    const update = encodeAwarenessUpdate(awareness, changedClients);
    const msg: AwareUpdateMessage = {
      kind: AWARE_UPDATE_KIND,
      clientId,
      update: Array.from(update),
    };
    channel.postMessage(msg);
  };
  awareness.on("update", awarenessUpdateHandler);

  // ── Incoming ──
  const onMessage = (event: MessageEvent<ChannelMessage>): void => {
    const msg = event.data;
    if (!msg || msg.clientId === clientId) return;
    switch (msg.kind) {
      case DOC_KIND: {
        // Apply with a non-local origin tag so subscribers can tell it's remote.
        // Avoid Y.applyUpdate import; use doc's transact + readUpdate via prototype.
        // Simpler: dynamic import of yjs at call time.
        void import("yjs").then((Yjs) => Yjs.applyUpdate(doc, Uint8Array.from(msg.update), "broadcast-channel"));
        break;
      }
      case DOC_QUERY_KIND: {
        // A newcomer is asking for our full doc state so they don't
        // start from an empty Y.Doc and trigger a redundant seed.
        // Reply with an encoded snapshot of our local doc.
        void import("yjs").then((Yjs) => {
          const update = Yjs.encodeStateAsUpdate(doc);
          const reply: DocMessage = {
            kind: DOC_KIND,
            clientId,
            update: Array.from(update),
          };
          channel.postMessage(reply);
        });
        break;
      }
      case AWARE_UPDATE_KIND: {
        applyAwarenessUpdate(awareness, Uint8Array.from(msg.update), "broadcast-channel");
        break;
      }
      case AWARE_QUERY_KIND: {
        // Reply with our full awareness state so the newcomer sees us.
        const localState = awareness.getLocalState();
        if (localState) {
          const update = encodeAwarenessUpdate(awareness, [clientId]);
          const reply: AwareUpdateMessage = {
            kind: AWARE_UPDATE_KIND,
            clientId,
            update: Array.from(update),
          };
          channel.postMessage(reply);
        }
        break;
      }
    }
  };
  channel.addEventListener("message", onMessage);

  // ── Handshake: announce ourselves so existing peers reply with their state.
  const query: AwareQueryMessage = { kind: AWARE_QUERY_KIND, clientId };
  channel.postMessage(query);
  // Also request the existing Y.Doc snapshot from any peer present;
  // without this a newcomer starts from an empty doc and our bridge's
  // seed-arbitration would race to seed concurrently with the
  // established host's already-present state.
  const docQuery: DocQueryMessage = { kind: DOC_QUERY_KIND, clientId };
  channel.postMessage(docQuery);

  // ── Tab-close cleanup ──
  // BroadcastChannel itself has no disconnect signal; without an
  // explicit removal broadcast, peers would hold a zombie awareness
  // entry for our clientID until y-protocols' 30s outdatedTimeout
  // pruned it. Wire <c>pagehide</c> (fires reliably on tab close,
  // including <c>page.close()</c> in Playwright) so we proactively
  // emit an awareness=null removal before the channel dies.
  const onPageHide = (): void => {
    awareness.destroy();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
  }

  return {
    awareness,
    destroy(): void {
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", onPageHide);
      }
      doc.off("update", docUpdateHandler);
      awareness.off("update", awarenessUpdateHandler);
      channel.removeEventListener("message", onMessage);
      channel.close();
      awareness.destroy();
    },
  };
}
