/**
 * Cross-SPA score handoff via URL fragment.
 *
 * Used by the MusicXML converter to ship a converted MNX document into the
 * editor SPA. The fragment is stripped immediately on receive, so the URL
 * stays clean and a hard-refresh won't double-load the score.
 *
 * Why a URL fragment instead of sessionStorage:
 *   - sessionStorage is per-origin and per-tab; the converter website route
 *     and the editor (:5173 in dev, app.viritura.com in prod) can be
 *     different origins, so sessionStorage is unreadable cross-app.
 *   - Fragments are not sent to servers, work cross-origin, and can carry
 *     up to ~2 MB in modern browsers. For typical converted scores
 *     (10–500 KB JSON) this is more than enough.
 *   - For huge scores that exceed the URL limit, callers should fall back
 *     to file download. `encodeHandoff` returns `null` in that case.
 */

/** Maximum encoded fragment length we'll attempt. Below all browsers' limits. */
export const MAX_HANDOFF_BYTES = 1_500_000;

/** Fragment key — appears as `#h=...` on the editor URL. */
export const HANDOFF_FRAGMENT_KEY = "h";

export interface ScoreHandoff {
  /** Schema version — bump if the handoff payload shape changes. */
  v: 1;
  /** ISO timestamp; lets the editor reject stale entries if needed. */
  ts: string;
  /** Suggested file name including .mnx extension. */
  fileName: string;
  /** Original source file (musicxml/xml/mxl) name for display. */
  sourceName: string;
  /** Serialized MNX JSON document. */
  json: string;
}

/** UTF-8 → base64url (RFC 4648 §5). */
function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url → bytes. Tolerates missing padding. */
function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Encode a handoff into a fragment string suitable for appending to a URL
 * as `#h=<value>`. Returns `null` if the payload exceeds `MAX_HANDOFF_BYTES`,
 * in which case the caller should fall back to file download.
 *
 * The payload is JSON → UTF-8 → base64url. We deliberately avoid compression
 * to keep the helper dependency-free; if size becomes a concern, swap in
 * `CompressionStream("gzip")` here without changing the public API.
 */
export function encodeHandoff(handoff: ScoreHandoff): string | null {
  const json = JSON.stringify(handoff);
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > MAX_HANDOFF_BYTES) return null;
  return `${HANDOFF_FRAGMENT_KEY}=${toBase64Url(bytes)}`;
}

/**
 * Build a complete URL for the editor with the handoff appended as a
 * fragment. `editorUrl` should be the bare editor entrypoint (e.g.
 * `http://localhost:5173` or `/app`).
 *
 * Returns `null` if encoding failed (payload too large).
 */
export function buildHandoffUrl(editorUrl: string, handoff: ScoreHandoff): string | null {
  const frag = encodeHandoff(handoff);
  if (!frag) return null;
  // Normalize trailing slash, strip any pre-existing fragment.
  const base = editorUrl.replace(/#.*$/, "");
  return `${base.endsWith("/") ? base : base + "/"}#${frag}`;
}

/**
 * Read a handoff payload from `window.location.hash` (or a provided string).
 * Returns `null` if no handoff is present or if the payload is malformed.
 *
 * Callers should call `clearHandoffFromUrl()` immediately after consuming
 * the result so a hard-refresh doesn't re-trigger the handoff path.
 */
export function readHandoffFromHash(hash: string): ScoreHandoff | null {
  if (!hash || hash.length < 2) return null;
  // hash includes leading "#"; strip it and parse as URL search-style pairs.
  const params = new URLSearchParams(hash.slice(1));
  const value = params.get(HANDOFF_FRAGMENT_KEY);
  if (!value) return null;
  try {
    const bytes = fromBase64Url(value);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as ScoreHandoff;
    if (parsed?.v !== 1 || typeof parsed.json !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Strip the handoff fragment from `window.location` without reloading or
 * pushing a new history entry.
 */
export function clearHandoffFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.hash) return;
  const params = new URLSearchParams(url.hash.slice(1));
  if (!params.has(HANDOFF_FRAGMENT_KEY)) return;
  params.delete(HANDOFF_FRAGMENT_KEY);
  const remaining = params.toString();
  url.hash = remaining ? `#${remaining}` : "";
  window.history.replaceState({}, "", url.toString());
}
