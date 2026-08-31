import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Bot } from "lucide-react";
import { Tooltip } from "@viritura/ui";
import { McpSessionPanel } from "./McpSessionPanel";
import { useMcpSessionStore } from "./sessionStore";
import styles from "./McpActivityButton.module.css";

/** Activity-bar entry point for exposing the active score to an external MCP client. */
export function McpActivityButton() {
  const [open, setOpen] = useState(false);
  const status = useMcpSessionStore((state) => state.status);
  const isActive = status === "waiting" || status === "connected";
  const hasError = status === "error";
  // One string for both the tooltip and the accessible name, so the visible
  // and announced labels can't drift apart.
  const label = isActive ? "MCP client connected — open panel" : "Connect MCP client";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* Opens to the right: the activity bar is a vertical strip, so a
       *  bottom-opening tooltip would cover the next button down. Suppressed
       *  while the popover is open, or it would sit over the panel. */}
      <Tooltip content={label} side="right" open={open ? false : undefined}>
        <Popover.Trigger asChild>
          {/* eslint-disable-next-line no-restricted-syntax -- activity-bar trigger needs an overlaid connection-status dot. */}
          <button
            type="button"
            className={styles.trigger}
            data-active={isActive ? "true" : "false"}
            data-error={hasError ? "true" : "false"}
            aria-label={label}
          >
            <Bot size={20} aria-hidden="true" />
            {isActive || hasError ? <span className={styles.statusDot} aria-hidden="true" /> : null}
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
          aria-label="MCP client panel"
        >
          <McpSessionPanel />
          <Popover.Arrow className={styles.arrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
