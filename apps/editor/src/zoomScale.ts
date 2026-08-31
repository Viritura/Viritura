/**
 * Zoom scaling constants & helpers.
 *
 * The layout engine emits coordinates at PX_PER_MM = 12 (12 layout px / mm).
 * A CSS pixel is *nominally* 1/96 inch ≈ 0.2646 mm (W3C), but the actual
 * physical size depends on the device, OS scaling, and browser zoom — all
 * of which combine into `window.devicePixelRatio` plus unknown panel DPI.
 *
 * To make "100%" zoom render at true physical (life) size, we let the user
 * calibrate by matching an on-screen credit card, inch ruler, or cm ruler
 * against the real object. The calibration is stored as `cssPxPerMm` in
 * localStorage, overriding the default 96-DPI assumption.
 *
 * Note: this only affects how the zoom is displayed and what "reset zoom"
 * lands on. It does NOT affect the underlying layout engine or PDF export
 * (which always uses absolute mm via `spatiumMm`).
 */

import { useEffect, useState } from "react";

/** Layout pixels per millimetre — must match `PX_PER_MM` in ScoreCanvas.tsx. */
const PX_PER_MM = 12;

/** Default CSS pixels per millimetre (W3C: 1 CSS px = 1/96 inch). */
export const DEFAULT_CSS_PX_PER_MM = 96 / 25.4; // ≈ 3.7795

const STORAGE_KEY = "viritura.calibration.cssPxPerMm";

const CHANGE_EVENT = "viritura:calibration-changed";

let cachedCssPxPerMm: number | null = null;

function readFromStorage(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const n = parseFloat(raw);
    if (!isFinite(n) || n <= 0) return null;
    return n;
  } catch {
    return null;
  }
}

/** Get the current CSS-px-per-mm value (calibrated if set, else W3C default). */
export function getCssPxPerMm(): number {
  if (cachedCssPxPerMm !== null) return cachedCssPxPerMm;
  const stored = readFromStorage();
  cachedCssPxPerMm = stored ?? DEFAULT_CSS_PX_PER_MM;
  return cachedCssPxPerMm;
}

/** Set and persist a new calibration value. Pass null to reset to default. */
export function setCssPxPerMm(value: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.localStorage.removeItem(STORAGE_KEY);
      cachedCssPxPerMm = DEFAULT_CSS_PX_PER_MM;
    } else {
      window.localStorage.setItem(STORAGE_KEY, String(value));
      cachedCssPxPerMm = value;
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // ignore
  }
}

/** True if the user has explicitly saved a calibration value. */
export function isCalibrated(): boolean {
  return readFromStorage() !== null;
}

/** Subscribe to calibration changes. Returns an unsubscribe function. */
export function onCalibrationChange(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/**
 * Force a host component to re-render whenever calibration changes. Useful
 * for status bars / chrome that display zoom percentages — the underlying
 * `zoom` value doesn't change, but its physical interpretation does, so the
 * formatted `formatZoomPercent(zoom)` label needs a re-render.
 */
export function useCalibrationRerender(): void {
  const [, setBump] = useState(0);
  useEffect(() => onCalibrationChange(() => setBump((n) => n + 1)), []);
}

/**
 * Viewport zoom multiplier at which on-screen size matches physical size.
 * Reads the live calibration value, so this updates as the user calibrates.
 */
export function getLifeSizeZoom(): number {
  return getCssPxPerMm() / PX_PER_MM;
}

/**
 * Static fallback exported for back-compat with code that captured the value
 * before any calibration was loaded. Prefer `getLifeSizeZoom()` for new code.
 */
export const LIFE_SIZE_ZOOM = DEFAULT_CSS_PX_PER_MM / PX_PER_MM;

/** Convert raw viewport zoom → user-facing percentage (100% = life size). */
export function zoomToPercent(zoom: number): number {
  return Math.round((zoom / getLifeSizeZoom()) * 100);
}

/** Convert user-facing percentage → raw viewport zoom. */
export function percentToZoom(percent: number): number {
  return (percent / 100) * getLifeSizeZoom();
}

/** Format zoom as a percentage string (e.g. "100%"). */
export function formatZoomPercent(zoom: number): string {
  return `${zoomToPercent(zoom)}%`;
}
