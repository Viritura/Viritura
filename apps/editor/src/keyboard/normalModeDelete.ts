import { executeDeletion } from "../commands/deletion";
import type { KeyboardHandlerContext } from "./types";

export function handleDelete(e: KeyboardEvent, ctrlHeld: boolean, ctx: KeyboardHandlerContext): void {
  const selection = ctx.getSelection();
  const removeBars = ctrlHeld && (selection.kind === "measure" || selection.kind === "range");
  if (
    executeDeletion(
      {
        getScore: ctx.getScore,
        getSelection: ctx.getSelection,
        getScoreIndex: () => ctx.getConfig().selectedScoreIndex ?? 0,
        updateScore: ctx.updateScore,
        selectElement: ctx.selectElement,
        clearSelection: ctx.clearSelection,
      },
      removeBars ? "remove-bars" : "selection",
    )
  ) {
    e.preventDefault();
  }
}
