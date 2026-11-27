import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PictureInPicture2 } from "lucide-react";
import { Button, IconButton } from "@viritura/ui";
import { ClickControls, ClickStartStop } from "./ClickControls";
import { ClickPulse } from "./ClickPulse";
import { FloatingTransport } from "./FloatingTransport";
import { clickPositionDisplay, describeClickBar } from "./barNavigation";
import { useClickControllerWindow, type ControllerWindowNotice } from "./useClickControllerWindow";
import { usePictureFit } from "./usePictureFit";
import type { useClickPlayer } from "./useClickPlayer";
import { useClickSettingsStore } from "../store/clickSettingsStore";
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
  const pictureContent = useRef<HTMLDivElement>(null);
  usePictureFit(controller.window, pictureContent, active);
  const flashMode = useClickSettingsStore((state) => state.flashMode);
  const detached = controller.window !== null;
  const error = player.error && (
    <p className={styles.error} role="alert">
      {player.error}
    </p>
  );
  const current = player.document?.bars[barIndex];
  const display =
    active && current && player.document && player.program
      ? clickPositionDisplay(current, player.document.timing, player.program, player.elapsed, player.tempoPercent)
      : undefined;
  const position = current && (
    <output
      className={styles.currentBar}
      aria-label="Playback position"
      // The readout changes every beat; announcing it would talk over the click.
      aria-live="off"
      aria-description={display?.description ?? describeClickBar(current)}
    >
      {display?.text ?? current.number}
    </output>
  );
  const controls = (hostAction: ReactNode, compact = false) =>
    player.document ? (
      <ClickControls
        player={player}
        active={active}
        compact={compact}
        barIndex={barIndex}
        dialSettling={dialSettling}
        onSettlingChange={onSettlingChange}
        position={position}
        hostAction={hostAction}
      />
    ) : null;
  const flash =
    active && player.program && flashMode !== "off" ? (
      <ClickPulse events={player.program.events} mode={flashMode} readTime={player.getPlaybackTime} />
    ) : undefined;

  return (
    <>
      <FloatingTransport busy={player.busy} compact={active || detached} background={flash}>
        {detached ? (
          <div className={styles.compactControls}>
            {position}
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
                  onClick={(event) => {
                    const panel = event.currentTarget.closest("section")?.getBoundingClientRect();
                    controller.open(
                      false,
                      panel ? { width: Math.ceil(panel.width), height: Math.ceil(panel.height) } : undefined,
                    );
                  }}
                >
                  <PictureInPicture2 size={20} />
                </IconButton>
              ),
              active,
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
            {flash}
            <div ref={pictureContent} className={styles.pipContent}>
              {error}
              {controls(null, active)}
            </div>
          </section>,
          controller.window.document.body,
        )}
    </>
  );
}
