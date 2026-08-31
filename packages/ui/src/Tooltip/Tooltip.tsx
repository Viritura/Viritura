import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import styles from "./Tooltip.module.css";

export interface TooltipProps {
  readonly content: string;
  readonly children: ReactNode;
  readonly side?: "top" | "bottom" | "left" | "right";
  /**
   * Controlled open state. When provided, the tooltip ignores hover/focus
   * and only shows when `open` is true. Use this to suppress the tooltip
   * while another surface (e.g. a popover anchored to the same trigger) is
   * open, which would otherwise overlap and block clicks.
   */
  readonly open?: boolean;
}

// NOTE: The TooltipPrimitives.Provider is mounted once at each app root
// (AppShell, Storybook preview decorators, and website root). We do NOT
// mount it per-instance here, because (a) thousands of instances would
// create thousands of redundant providers and (b) `skipDelayDuration` (the
// "if a tooltip is showing, adjacent ones open instantly" behavior) only
// works when adjacent tooltips share a single provider.
//
// Radix's Tooltip.Root is cheap while closed — it only mounts the
// Portal/Content/Popper machinery once `open` flips true. There is therefore
// no lazy-mount wrapper here: an earlier "arm on first pointer-enter" hack
// mounted the tree with `open` forced to `true`, which raced Radix's own
// open/close timers and left tooltips stuck open or flickering. Keeping the
// per-button count sane (tooltips are reserved for icon/glyph-only controls
// and shortcut hints) means plain Radix roots are inexpensive at scale.
export function Tooltip({ content, children, side = "bottom", open }: TooltipProps) {
  // Switching a Radix root between an omitted `open` prop (uncontrolled) and
  // a boolean (controlled) is unsupported. The key deliberately remounts the
  // root when callers temporarily suppress a tooltip while a popover is open.
  const controlMode = open === undefined ? "uncontrolled" : "controlled";
  return (
    <RadixTooltip.Root key={controlMode} {...(open === undefined ? {} : { open })}>
      {/* asChild merges Radix's trigger props onto the single child element
       * directly. We deliberately do NOT add a wrapping <span> here — that
       * wrapper used to default to `display: inline-flex`, which silently
       * broke parent layout assumptions (e.g. `flex: 1` on the inner tab
       * button stopped applying because the immediate flex child was now
       * the wrapper span, not the button; ListRow rows similarly stopped
       * filling their container width). Callers must pass exactly one
       * React element as children. */}
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className={styles.content} side={side} sideOffset={4}>
          {content}
          <RadixTooltip.Arrow className={styles.arrow} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/**
 * `withTooltip` helper lives in `./withTooltip` (a separate `.tsx` file)
 * so this module exports a single component, satisfying
 * `react-refresh/only-export-components`.
 */

export { RadixTooltip as TooltipPrimitives };
