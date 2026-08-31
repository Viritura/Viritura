/**
 * CollaboratorPresence — list of peers currently in the active live
 * session, including the local user. Each row carries the peer's color
 * and (when in note-input mode or the cursor is positioned) a short
 * location tag like "m12·b2".
 *
 * Rendered as a proper `<ul role="list">` so it's queryable by
 * accessible role/name from Playwright (E2E asserts on
 * `getByRole("listitem", { name: /…/ })`) — no `data-testid` needed.
 */

import { type CSSProperties } from "react";
import type { CollaboratorIdentity, VirituraAwarenessState } from "@viritura/crdt";
import { useLiveSessionStore } from "./liveSessionStore";
import { useRemotePeers } from "./useRemotePeers";

const ROOT_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: "100%",
  paddingInline: 8,
  margin: 0,
  padding: 0,
  listStyle: "none",
};

function chipStyle(color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: "var(--type-eyebrow-size)",
    fontWeight: "var(--type-control-weight)",
    background: `color-mix(in srgb, ${color} 18%, transparent)`,
    color,
    border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
    lineHeight: 1.4,
  };
}

const DOT_STYLE_BASE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
};

function dotStyle(color: string): CSSProperties {
  return { ...DOT_STYLE_BASE, background: color };
}

const LOC_STYLE: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  opacity: 0.75,
  fontSize: "var(--type-eyebrow-size)",
};

interface CollaboratorPresenceProps {
  /** The local user's identity (rendered first when present). */
  readonly localIdentity?: CollaboratorIdentity | null;
}

export function CollaboratorPresence({ localIdentity }: CollaboratorPresenceProps) {
  const session = useLiveSessionStore((s) => s.session);
  const remotePeers = useRemotePeers();

  if (!session) return null;

  return (
    <ul style={ROOT_STYLE} role="list" aria-label="Live session participants">
      {localIdentity ? (
        <li style={chipStyle(localIdentity.color)} data-user-id={localIdentity.userId} data-self="true">
          <span style={dotStyle(localIdentity.color)} aria-hidden />
          <span>{localIdentity.displayName} (you)</span>
        </li>
      ) : null}
      {remotePeers.map((peer) => {
        const { identity } = peer.state;
        return (
          <li
            key={peer.clientId}
            style={chipStyle(identity.color)}
            data-user-id={identity.userId}
            data-mode={peer.state.mode}
          >
            <span style={dotStyle(identity.color)} aria-hidden />
            <span>{identity.displayName}</span>
            {renderLocation(peer.state)}
          </li>
        );
      })}
    </ul>
  );
}

function renderLocation(state: VirituraAwarenessState) {
  const c = state.cursor;
  if (!c) return null;
  const label = `m${c.measureIndex + 1}·b${(c.beatPosition + 1).toFixed(0)}`;
  return <span style={LOC_STYLE}>{label}</span>;
}
