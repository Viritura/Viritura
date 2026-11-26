import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { currentPictureWindow, isDocumentPipSupported, openPictureWindow } from "@viritura/ui";

export type ControllerWindowNotice = "unsupported" | "conflict" | "failed";

export interface ClickControllerWindow {
  /** The always-on-top window hosting the controls, while open. */
  readonly window: Window | null;
  readonly opening: boolean;
  readonly notice?: ControllerWindowNotice;
  /** Must run from a user gesture. `replaceOther` closes another picture window the tab owns. */
  readonly open: (replaceOther?: boolean) => void;
  readonly close: () => void;
  readonly dismissNotice: () => void;
}

const SIZE = { width: 400, height: 340 };

function isEditingTarget(target: EventTarget | null): boolean {
  // Elements in the picture window belong to its realm, so `instanceof HTMLElement` from the opener fails.
  const element = target as { matches?: (selector: string) => boolean; isContentEditable?: boolean } | null;
  return Boolean(element?.matches?.("input, textarea, select, button") || element?.isContentEditable);
}

/**
 * Hosts the click controls in a Document Picture-in-Picture window. The opener keeps
 * ownership of audio, transport, and selection; the window only renders shared
 * state and sends commands, so opening or closing it never starts or stops sound.
 */
export function useClickControllerWindow(toggle: () => void): ClickControllerWindow {
  const [win, setWin] = useState<Window | null>(null);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<ControllerWindowNotice>();
  const own = useRef<Window | null>(null);
  const mounted = useRef(true);
  const onSpace = useEffectEvent(toggle);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      own.current?.close();
      own.current = null;
    };
  }, []);

  useEffect(() => {
    if (!win) return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || isEditingTarget(event.target)) return;
      event.preventDefault();
      onSpace();
    };
    win.addEventListener("keydown", keyDown);
    return () => win.removeEventListener("keydown", keyDown);
  }, [win]);

  const open = useCallback((replaceOther = false) => {
    if (own.current) {
      own.current.focus();
      return;
    }
    if (!isDocumentPipSupported()) {
      setNotice("unsupported");
      return;
    }
    if (currentPictureWindow() && !replaceOther) {
      setNotice("conflict");
      return;
    }
    setNotice(undefined);
    setOpening(true);
    openPictureWindow(SIZE)
      .then((opened) => {
        if (!mounted.current) {
          opened.close();
          return;
        }
        own.current = opened;
        opened.document.title = "Click controls";
        opened.addEventListener(
          "pagehide",
          () => {
            if (own.current !== opened) return;
            own.current = null;
            if (!mounted.current) return;
            setWin(null);
            window.focus();
          },
          { once: true },
        );
        setWin(opened);
      })
      .catch(() => {
        if (mounted.current) setNotice("failed");
      })
      .finally(() => {
        if (mounted.current) setOpening(false);
      });
  }, []);

  const close = useCallback(() => own.current?.close(), []);
  const dismissNotice = useCallback(() => setNotice(undefined), []);

  return { window: win, opening, notice, open, close, dismissNotice };
}
