/**
 * LivePanel — body content for the activity-bar Live popover.
 *
 * Mirrors the VS Code Live Share side panel: a single surface that holds
 * every live-collaboration affordance — start/copy/leave controls at the
 * top, room metadata in the middle, and the participant roster
 * ({@link CollaboratorPresence}) at the bottom.
 *
 * Intentionally has no chrome of its own (no header bar, no card frame);
 * it's mounted inside {@link LiveActivityButton}'s Radix Popover which
 * supplies the surface treatment.
 */

import { useCallback, type CSSProperties } from "react";
import { toast } from "sonner";
import { Copy, LogOut, Radio } from "lucide-react";
import { Button } from "@viritura/ui";
import type { CollaboratorIdentity } from "@viritura/crdt";
import { CollaboratorPresence } from "./CollaboratorPresence";
import { useLiveSessionStore } from "./liveSessionStore";
import { buildShareUrl, clearLiveRoomIdFromUrl, setLiveRoomIdInUrl } from "./liveUrl";

const ROOT_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minWidth: 280,
};

const HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: "var(--type-small-size)",
  fontWeight: "var(--type-heading-weight)",
  color: "var(--text-bright, var(--text))",
};

const SUBLINE_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  color: "var(--text-muted)",
  marginTop: 2,
  lineHeight: 1.4,
};

const SECTION_LABEL_STYLE: CSSProperties = {
  fontSize: "var(--type-eyebrow-size)",
  fontWeight: "var(--type-heading-weight)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 6,
};

const ROOM_ID_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  fontSize: "var(--type-eyebrow-size)",
  letterSpacing: "0.02em",
  padding: "6px 8px",
  borderRadius: 6,
  background: "var(--surface-sunken, rgba(0,0,0,0.18))",
  color: "var(--text)",
  wordBreak: "break-all",
};

const ACTIONS_ROW_STYLE: CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
};

const ACTIONS_ROW_WITH_MARGIN_STYLE: CSSProperties = {
  ...ACTIONS_ROW_STYLE,
  marginTop: 8,
};

const STATUS_DOT_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  background: "var(--accent, #215e4e)",
  boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent, #215e4e) 25%, transparent)",
};

const PRESENCE_WRAP_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
};

const INLINE_BTN_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

export interface LivePanelProps {
  readonly identity: CollaboratorIdentity | null;
  readonly scoreId?: string;
}

export function LivePanel({ identity, scoreId }: LivePanelProps) {
  const session = useLiveSessionStore((s) => s.session);
  const roomId = useLiveSessionStore((s) => s.roomId);
  const startLive = useLiveSessionStore((s) => s.startLive);
  const stopLive = useLiveSessionStore((s) => s.stopLive);

  const handleStart = useCallback(() => {
    if (!identity) {
      toast.error("Pick a display name before going live.");
      return;
    }
    const id = startLive({ identity, scoreId });
    setLiveRoomIdInUrl(id);
    const shareUrl = buildShareUrl(id);
    void copyToClipboard(shareUrl).then((ok) => {
      if (ok) toast.success("Live session started — link copied.");
      else toast.message("Live session started", { description: shareUrl });
    });
  }, [identity, scoreId, startLive]);

  const handleCopy = useCallback(() => {
    if (!roomId) return;
    const shareUrl = buildShareUrl(roomId);
    void copyToClipboard(shareUrl).then((ok) => {
      if (ok) toast.success("Live link copied.");
      else toast.message("Live link", { description: shareUrl });
    });
  }, [roomId]);

  const handleLeave = useCallback(() => {
    stopLive();
    clearLiveRoomIdFromUrl();
    toast.message("Left live session");
  }, [stopLive]);

  if (!session || !roomId) {
    return (
      <div style={ROOT_STYLE}>
        <div>
          <div style={HEADER_STYLE}>
            <Radio size={14} aria-hidden /> Live collaboration
          </div>
          <div style={SUBLINE_STYLE}>
            Share a capability link to edit this score with someone in real time. Anyone with the link can join — no
            account required.
          </div>
        </div>
        <Button onClick={handleStart} variant="primary" size="sm" label="Start live session" />
      </div>
    );
  }

  const shareUrl = buildShareUrl(roomId);
  return (
    <div style={ROOT_STYLE}>
      <div>
        <div style={HEADER_STYLE}>
          <span style={STATUS_DOT_STYLE} aria-hidden />
          <span>Live — session active</span>
        </div>
        <div style={SUBLINE_STYLE}>
          Anyone with this link can join and edit. Closing the host page ends the session for everyone.
        </div>
      </div>

      <div>
        <div style={SECTION_LABEL_STYLE} id="live-share-link-label">
          Share link
        </div>
        <div style={ROOM_ID_STYLE} role="textbox" aria-readonly="true" aria-labelledby="live-share-link-label">
          {shareUrl}
        </div>
        <div style={ACTIONS_ROW_WITH_MARGIN_STYLE}>
          <Button onClick={handleCopy} variant="primary" size="sm">
            <span style={INLINE_BTN_STYLE}>
              <Copy size={14} aria-hidden /> Copy link
            </span>
          </Button>
          <Button onClick={handleLeave} variant="ghost" size="sm">
            <span style={INLINE_BTN_STYLE}>
              <LogOut size={14} aria-hidden /> Leave
            </span>
          </Button>
        </div>
      </div>

      <div>
        <div style={SECTION_LABEL_STYLE}>Participants</div>
        <div style={PRESENCE_WRAP_STYLE}>
          <CollaboratorPresence localIdentity={identity} />
        </div>
      </div>
    </div>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}
