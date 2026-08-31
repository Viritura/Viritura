/**
 * Document Picture-in-Picture.
 *
 * Standard video PiP gives an always-on-top window but hands its contents to
 * the browser: the controls are browser-owned, nothing can be drawn over the
 * picture, and there is nowhere to put a streamer. For scoring that is
 * disqualifying — the overlay *is* the feature.
 *
 * Document PiP solves it by giving us an always-on-top window that hosts
 * ordinary DOM. Everything the composer sees in it is ours: our controls, our
 * timecode, our streamers, styled with the same tokens as the rest of the app.
 *
 * Availability is narrow (Chromium only at time of writing), so every entry
 * point is capability-checked and the caller falls back to an in-page floating
 * panel that renders the identical surface.
 */

interface DocumentPipOptions {
  width?: number;
  height?: number;
}

interface DocumentPictureInPicture {
  requestWindow(options?: DocumentPipOptions): Promise<Window>;
  window: Window | null;
}

function api(): DocumentPictureInPicture | null {
  const holder = globalThis as { documentPictureInPicture?: DocumentPictureInPicture };
  return holder.documentPictureInPicture ?? null;
}

/** Whether a document PiP window can be opened in this runtime. */
export function isDocumentPipSupported(): boolean {
  return typeof api()?.requestWindow === "function";
}

/** The open PiP window, if this document owns one. */
export function currentPictureWindow(): Window | null {
  return api()?.window ?? null;
}

/**
 * Open a PiP window and prepare it to host our UI.
 *
 * Must be called from a user gesture; the rejection is left to surface so the
 * UI can explain rather than silently doing nothing.
 */
export async function openPictureWindow(options: DocumentPipOptions = {}): Promise<Window> {
  const pip = api();
  if (!pip?.requestWindow) throw new Error("This browser cannot open a picture window.");
  const win = await pip.requestWindow({ width: options.width ?? 480, height: options.height ?? 300 });
  copyStyles(win);
  return win;
}

export function closePictureWindow(): void {
  currentPictureWindow()?.close();
}

/**
 * Give the PiP window the app's stylesheets.
 *
 * A PiP window starts with an empty document, so none of our CSS — including
 * the design tokens everything else reads — is there. Same-origin sheets are
 * cloned rule by rule; cross-origin ones cannot be read, so they are re-linked
 * and left to load normally.
 */
function copyStyles(win: Window): void {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      const style = win.document.createElement("style");
      style.textContent = rules;
      win.document.head.append(style);
    } catch {
      // Cross-origin sheet: its rules are unreadable, but the link is not.
      const href = sheet.href;
      if (!href) continue;
      const link = win.document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      win.document.head.append(link);
    }
  }

  // The theme lives in a data attribute on <html>, and none of the token
  // variables resolve without it.
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme) win.document.documentElement.setAttribute("data-theme", theme);
  win.document.body.style.margin = "0";
}
