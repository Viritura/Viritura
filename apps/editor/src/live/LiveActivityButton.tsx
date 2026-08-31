/**
 * LiveActivityButton — activity-bar entry point for live collaboration.
 *
 * Models VS Code's Live Share extension: a single icon in the activity
 * bar with a status dot when a session is active, opening a side-popover
 * with the full session controls (start / copy link / leave) and the
 * participant roster.
 *
 * The popover is *controlled* and auto-opens the first time a session
 * becomes active, so peers immediately see the shareable link and the
 * collaborator chips without an extra click. Subsequent close/open
 * follows normal user intent — once dismissed, joining a new session
 * later won't pop back open until the user clicks the button.
 */

import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Radio } from "lucide-react";
import { Tooltip } from "@viritura/ui";
import { useLocalIdentity } from "./LiveSessionProvider";
import { LivePanel } from "./LivePanel";
import { useLiveSessionStore } from "./liveSessionStore";
import styles from "./LiveActivityButton.module.css";

export interface LiveActivityButtonProps {
  readonly scoreId?: string;
}

export function LiveActivityButton({ scoreId }: LiveActivityButtonProps) {
  const identity = useLocalIdentity();
  const status = useLiveSessionStore((s) => s.status);
  const isActive = status === "active";

  const [open, setOpen] = useState(false);
  // Track whether we've already auto-opened for this session-active cycle
  // so a user-dismissed popover doesn't keep popping back on every render.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (isActive && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setOpen(true);
    } else if (!isActive) {
      autoOpenedRef.current = false;
    }
  }, [isActive]);

  // One string for both the tooltip and the accessible name, so the visible
  // and announced labels can't drift apart.
  const label = isActive ? "Live session — open panel" : "Start live session";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* Opens to the right: the activity bar is a vertical strip, so a
       *  bottom-opening tooltip would cover the next button down. Suppressed
       *  while the popover is open, or it would sit over the panel. */}
      <Tooltip content={label} side="right" open={open ? false : undefined}>
        <Popover.Trigger asChild>
          {/* eslint-disable-next-line no-restricted-syntax -- activity-bar trigger; bespoke chrome with absolutely-positioned status dot, no @viritura/ui primitive models it. */}
          <button type="button" className={styles.trigger} data-active={isActive ? "true" : "false"} aria-label={label}>
            <Radio size={20} aria-hidden="true" />
            {isActive ? <span className={styles.statusDot} aria-hidden="true" /> : null}
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          className={styles.popover}
          side="right"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Live session panel"
        >
          <LivePanel identity={identity} scoreId={scoreId} />
          <Popover.Arrow className={styles.arrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
