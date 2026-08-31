/**
 * VideoStage — where the `<video>` element lives.
 *
 * The element is mounted here for the whole life of the provider and is never
 * reparented. It is the decoder, not the display: what the composer watches is
 * the pop-out picture window, which mirrors these frames onto a canvas and
 * draws streamers over them. Keeping the element in one place means opening or
 * closing the pop-out can never interrupt decoding or drop the object URL.
 *
 * The card is still shown inline when the pop-out is closed, so an attached
 * picture is visible without any extra step, and it is where the demo clip's
 * required credit line is rendered.
 */

import type { RefObject } from "react";
import styles from "./VideoStage.module.css";

export interface VideoStageProps {
  /** Ref the provider binds to the media element. */
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  /** Whether the floating card is shown (false while PiP owns the picture). */
  readonly visible: boolean;
  /** Credit line required by the demo clip's licence, when one applies. */
  readonly attribution?: string | null;
  /** Link backing the credit line. */
  readonly attributionUrl?: string | null;
}

export function VideoStage({ videoRef, visible, attribution, attributionUrl }: VideoStageProps) {
  return (
    <div className={visible ? styles.stage : styles.stageHidden} data-testid="video-stage">
      {/* A reference cut supplied by the composer; there is no caption track to
          attach, and the element is a scoring tool rather than published media.

          `crossOrigin` is load-bearing, not decoration: the editor is served
          cross-origin isolated (COOP/COEP `require-corp`) so the layout engine
          can use SharedArrayBuffer, and under `require-corp` a no-cors
          cross-origin subresource is refused outright
          (ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep).
          Requesting in CORS mode is what lets any cross-origin picture load at
          all. */}
      <video ref={videoRef} className={styles.video} crossOrigin="anonymous" playsInline preload="metadata" />
      {visible && attribution ? (
        <a className={styles.credit} href={attributionUrl ?? undefined} target="_blank" rel="noreferrer noopener">
          {attribution}
        </a>
      ) : null}
    </div>
  );
}
