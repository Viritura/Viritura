import type { ReactNode } from "react";
import { Tooltip, type TooltipProps } from "./Tooltip";

/**
 * Wraps a rendered element in a Tooltip when `tooltip` is a non-empty string,
 * otherwise returns the element unchanged. Used by interactive primitives
 * (Button, IconButton, Slider, …) so they can accept a `tooltip` prop without
 * conditional JSX at every call site.
 */
export function withTooltip(node: ReactNode, tooltip: string | undefined, side?: TooltipProps["side"]): ReactNode {
  if (!tooltip) return node;
  return (
    <Tooltip content={tooltip} side={side}>
      {node}
    </Tooltip>
  );
}
