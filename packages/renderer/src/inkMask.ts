import type { DisplayList, RenderCommand } from "./wasm";

type InkContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type EraseRect = Extract<RenderCommand, { type: "EraseRect" }>;

/** Retained system partitions precede the final overlay; normalize frame ink
 * only after they are assembled, just as the Rust full-frame path does. */
export function raiseStaffEraseFrames(displayList: DisplayList): RenderCommand[] {
  return normalizeErasingFrameOrder(displayList).commands;
}

export function normalizeErasingFrameOrder(displayList: DisplayList): Pick<DisplayList, "commands" | "elementIds"> {
  const { commands, elementIds = [] } = displayList;
  const ids = new Set(
    commands.flatMap((command, index) => {
      const id = elementIds[index];
      return command.type === "EraseRect" && id?.includes("/expr") ? [id] : [];
    }),
  );
  if (ids.size === 0) return { commands, elementIds: displayList.elementIds };
  const pageStart = elementIds.findIndex((id) => id?.startsWith("text-frame/"));
  const end = pageStart < 0 ? commands.length : pageStart;
  const firstFrame = elementIds.findIndex((id) => ids.has(id ?? ""));
  if (
    commands
      .slice(firstFrame, end)
      .every((command, offset) => command.type === "SetOpacity" || ids.has(elementIds[firstFrame + offset] ?? ""))
  ) {
    return { commands, elementIds: displayList.elementIds };
  }
  const ink: number[] = [];
  const frames: number[] = [];
  for (let index = 0; index < end; index++) {
    (ids.has(elementIds[index] ?? "") ? frames : ink).push(index);
  }
  const order = [...ink, ...frames, ...commands.slice(end).map((_, index) => end + index)];
  const opacity: number[] = [];
  let alpha = 1;
  for (const command of commands) {
    if (command.type === "SetOpacity") alpha = command.opacity;
    opacity.push(alpha);
  }
  const result: RenderCommand[] = [];
  const idsOut: (string | null)[] = [];
  alpha = 1;
  for (const index of order) {
    if (alpha !== opacity[index]) {
      alpha = opacity[index]!;
      result.push({ type: "SetOpacity", opacity: alpha });
      idsOut.push(null);
    }
    result.push(commands[index]!);
    idsOut.push(elementIds[index] ?? null);
  }
  return { commands: result, elementIds: idsOut };
}

/**
 * Clip earlier ink against later knockout rectangles. Paper is painted outside
 * this pass, so even textured or transparent surfaces remain untouched.
 */
export function paintInkCommands(
  ctx: InkContext,
  commands: readonly RenderCommand[],
  paint: (command: RenderCommand) => void,
): void {
  const masks = commands.flatMap((command, index) => (command.type === "EraseRect" ? [{ command, index }] : []));
  if (masks.length === 0) {
    for (const command of commands) paint(command);
    return;
  }
  let start = 0;
  for (let i = 0; i <= masks.length; i++) {
    const end = masks[i]?.index ?? commands.length;
    ctx.save();
    for (let j = i; j < masks.length; j++) clipOutside(ctx, masks[j]!.command);
    for (let index = start; index < end; index++) paint(commands[index]!);
    const opacity = ctx.globalAlpha;
    ctx.restore();
    ctx.globalAlpha = opacity;
    start = end + 1;
  }
}

function clipOutside(ctx: InkContext, mask: EraseRect): void {
  const t = ctx.getTransform();
  const determinant = t.a * t.d - t.b * t.c;
  if (determinant === 0) return;
  const corners = [
    [0, 0],
    [ctx.canvas.width, 0],
    [0, ctx.canvas.height],
    [ctx.canvas.width, ctx.canvas.height],
  ];
  const points = corners.map(([x = 0, y = 0]) => [
    (t.d * (x - t.e) - t.c * (y - t.f)) / determinant,
    (-t.b * (x - t.e) + t.a * (y - t.f)) / determinant,
  ]);
  const left = Math.min(mask.x, ...points.map(([x]) => x!)) - 1;
  const top = Math.min(mask.y, ...points.map(([, y]) => y!)) - 1;
  const right = Math.max(mask.x + mask.w, ...points.map(([x]) => x!)) + 1;
  const bottom = Math.max(mask.y + mask.h, ...points.map(([, y]) => y!)) + 1;
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.rect(mask.x, mask.y, mask.w, mask.h);
  ctx.clip("evenodd");
}
