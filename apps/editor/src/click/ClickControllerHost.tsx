import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { PictureInPicture2 } from "lucide-react";
import { Button, IconButton } from "@viritura/ui";
import { ClickControls, ClickStartStop } from "./ClickControls";
import { FloatingTransport } from "./FloatingTransport";
import { describeClickBar } from "./barNavigation";
import { useClickControllerWindow, type ControllerWindowNotice } from "./useClickControllerWindow";
import type { useClickPlayer } from "./useClickPlayer";
import styles from "./ClickView.module.css";

interface ClickControllerHostProps {
  readonly player: ReturnType<typeof useClickPlayer>;
  readonly active: boolean;
  readonly barIndex: number;
  readonly dialSettling: boolean;
  readonly onSettlingChange: (settling: boolean) => void;
  readonly toggle: () => void;
  /** Screen-reader status; stays in the opener so it is announced wherever focus is. */
  readonly status: ReactNode;
}

const NOTICES: Readonly<Record<ControllerWindowNotice, string>> = {
  unsupported: "This browser can't keep the controls above other apps, so they stay in this window.",
  conflict: "The picture window is open, and only one window can stay above other apps.",
  failed: "The controls couldn't open in a separate window. They stay in this window.",
};

/**
 * One controller surface, two hosts: the in-page floating transport, or a
 * Document Picture-in-Picture window that stays above a DAW. The opener keeps
 * Start/Stop available while the controls are detached.
 */
export function ClickControllerHost({
  player,
  active,
  barIndex,
  dialSettling,
  onSettlingChange,
  toggle,
  status,
}: ClickControllerHostProps) {
  const controller = useClickControllerWindow(toggle);
  const detached = controller.window !== null;
  const error = player.error && (
    <p className={styles.error} role="alert">
      {player.error}
    </p>
  );
  const controls = (hostAction: ReactNode) =>
    player.document ? (
      <ClickControls
        player={player}
        active={active}
        barIndex={barIndex}
        dialSettling={dialSettling}
        onSettlingChange={onSettlingChange}
        hostAction={hostAction}
      />
    ) : null;
  const current = player.document?.bars[barIndex];

  return (
    <>
      <FloatingTransport busy={player.busy} compact={active || detached}>
        {detached ? (
          <div className={styles.compactControls}>
            {current && (
              <output
                className={styles.currentBar}
                aria-label="Current bar"
                aria-description={describeClickBar(current)}
              >
                {current.number}
              </output>
            )}
            <p className={styles.detachedNote}>Controls are in a separate window.</p>
            <div className={styles.transport}>
              <ClickStartStop player={player} active={active} dialSettling={dialSettling} />
              <Button variant="default" size="lg" onClick={controller.close}>
                Return controls
              </Button>
            </div>
          </div>
        ) : (
          <>
            {error}
            {controls(
              active ? null : (
                <IconButton
                  tooltip="Keep above other apps"
                  variant="default"
                  disabled={controller.opening}
                  onClick={() => controller.open()}
                >
                  <PictureInPicture2 size={20} />
                </IconButton>
              ),
            )}
            {controller.notice && (
              <div className={styles.controllerNotice} role="status">
                <p>{NOTICES[controller.notice]}</p>
                {controller.notice === "conflict" && (
                  <Button variant="default" onClick={() => controller.open(true)}>
                    Replace picture window
                  </Button>
                )}
                <Button variant="ghost" onClick={controller.dismissNotice}>
                  Dismiss
                </Button>
              </div>
            )}
          </>
        )}
        {status}
      </FloatingTransport>
      {controller.window &&
        createPortal(
          <section className={styles.pipController} aria-label="Click player" aria-busy={player.busy}>
            {error}
            {controls(
              <Button variant="default" size="lg" onClick={controller.close}>
                Return to editor
              </Button>,
            )}
          </section>,
          controller.window.document.body,
        )}
    </>
  );
}
