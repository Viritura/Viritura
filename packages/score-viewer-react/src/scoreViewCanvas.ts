import type { CSSProperties } from "react";

export function stylePageCanvases(surface: HTMLElement, className?: string, style?: CSSProperties): void {
  for (const canvas of surface.querySelectorAll<HTMLCanvasElement>("canvas[data-page]")) {
    canvas.className = className ?? "";
    if (style) Object.assign(canvas.style, style);
  }
}
