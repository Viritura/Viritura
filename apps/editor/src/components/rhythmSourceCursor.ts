import type { Score } from "@viritura/core";
import type { DisplayList, SpatialIndex, StaffInfo } from "@viritura/renderer";
import type { CursorPosition, RhythmSource } from "../store/noteInputStore";
import { mapEnginePointToViewport, resolveCursorX, resolveStaffForCursor } from "./inputCursorHelpers";

interface PaintRhythmSourceCursorArgs {
  cursor: CursorPosition;
  source: RhythmSource;
  staves: StaffInfo[];
  spatialIndex: SpatialIndex;
  score: Score;
  displayList: DisplayList | null;
  viewMode: "page" | "spread" | "spread-h" | "horizon";
}

const SOURCE_COLOR = "rgba(98, 82, 170, 0.82)";

function paintGlassesBadge(ctx: CanvasRenderingContext2D, x: number, y: number, spatium: number): void {
  const radius = Math.max(2.2, spatium * 0.25);
  const gap = radius * 0.65;
  const badgeWidth = radius * 5.6;
  const badgeHeight = radius * 3.1;
  const badgeY = y - badgeHeight - radius * 0.8;

  ctx.save();
  ctx.fillStyle = SOURCE_COLOR;
  ctx.beginPath();
  ctx.roundRect(x - badgeWidth / 2, badgeY, badgeWidth, badgeHeight, radius);
  ctx.fill();

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = Math.max(1, spatium * 0.11);
  const lensY = badgeY + badgeHeight * 0.55;
  ctx.beginPath();
  ctx.arc(x - radius - gap / 2, lensY, radius, 0, Math.PI * 2);
  ctx.arc(x + radius + gap / 2, lensY, radius, 0, Math.PI * 2);
  ctx.moveTo(x - gap / 2, lensY);
  ctx.lineTo(x + gap / 2, lensY);
  ctx.stroke();
  ctx.restore();
}

export function paintRhythmSourceCursor(ctx: CanvasRenderingContext2D, args: PaintRhythmSourceCursorArgs): void {
  const { cursor, source, staves, spatialIndex, score, displayList, viewMode } = args;
  const sourceCursor: CursorPosition = {
    measureIndex: cursor.measureIndex,
    beatPosition: cursor.beatPosition,
    partIndex: source.partIndex,
    staffIndex: source.staffIndex,
  };
  const sourceIsVisible = displayList?.measureBounds?.some(
    (bounds) => bounds.index === cursor.measureIndex && bounds.partIndex === source.partIndex,
  );
  if (!sourceIsVisible) return;

  const x = resolveCursorX(
    cursor.measureIndex,
    cursor.beatPosition,
    source.partIndex,
    source.voice - 1,
    spatialIndex,
    score,
    displayList,
  );
  const staff = resolveStaffForCursor(sourceCursor, staves, displayList);
  if (x === null || !staff) return;

  const visual = mapEnginePointToViewport({ x, y: staff.y }, displayList, viewMode);
  const top = visual.y - staff.spatium * 0.5;
  const bottom = visual.y + staff.height + staff.spatium * 0.5;

  ctx.save();
  ctx.strokeStyle = SOURCE_COLOR;
  ctx.lineWidth = Math.max(1, staff.spatium * 0.14);
  ctx.setLineDash([staff.spatium * 0.45, staff.spatium * 0.32]);
  ctx.beginPath();
  ctx.moveTo(visual.x, top);
  ctx.lineTo(visual.x, bottom);
  ctx.stroke();
  ctx.restore();

  paintGlassesBadge(ctx, visual.x, top, staff.spatium);
}
