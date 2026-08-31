import type { SlurGeometry } from "@viritura/renderer";

/** Hit-test radius (px) for a slur bezier handle. */
const SLUR_HANDLE_HIT_R = 8;

export type SlurHandleHit = {
  elementId: string;
  handle: "p0" | "p1" | "p2" | "p3" | "pm";
  sp: number;
  geom: SlurGeometry;
};

/**
 * Hit-test a point (engine layout coordinates) against the painted bezier
 * handles of the currently selected slur. Returns the closest handle within
 * `SLUR_HANDLE_HIT_R` px, or null. When `selectedSlurId` is null no handles
 * are interactive (they aren't drawn either).
 */
export function hitTestSlurHandle(
  slurGeometries: readonly SlurGeometry[] | undefined,
  selectedSlurId: string | null,
  x: number,
  y: number,
  scope: "all" | "endpoints" = "all",
): SlurHandleHit | null {
  if (!slurGeometries || slurGeometries.length === 0 || !selectedSlurId) return null;
  const g = slurGeometries.find((sg) => sg.elementId === selectedSlurId);
  if (!g) return null;
  const r2 = SLUR_HANDLE_HIT_R * SLUR_HANDLE_HIT_R;
  let best: SlurHandleHit | null = null;
  let bestD2 = r2;
  const tryHandle = (h: "p0" | "p1" | "p2" | "p3" | "pm", hx: number, hy: number) => {
    const dx = hx - x;
    const dy = hy - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = { elementId: g.elementId, handle: h, sp: g.sp, geom: g };
    }
  };
  tryHandle("p0", g.p0x, g.p0y);
  tryHandle("p3", g.p3x, g.p3y);
  if (scope === "endpoints") return best;
  tryHandle("p1", g.p1x, g.p1y);
  tryHandle("p2", g.p2x, g.p2y);
  // Midpoint of the spine cubic at t = 0.5 — Illustrator-style on-curve grab
  // point. Tested last so an endpoint or bezier CP at exactly the same
  // location (degenerate slur) wins.
  const pmx = (g.p0x + 3 * g.p1x + 3 * g.p2x + g.p3x) / 8;
  const pmy = (g.p0y + 3 * g.p1y + 3 * g.p2y + g.p3y) / 8;
  tryHandle("pm", pmx, pmy);
  return best;
}
