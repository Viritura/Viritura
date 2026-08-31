import { forwardRef, type CSSProperties, type MouseEvent, type ReactNode, type Ref } from "react";
import { Button, type ButtonProps } from "../Button/Button";

export interface IconButtonProps {
  /** Icon (or compact text glyph like "M"/"S") to render */
  children: ReactNode;
  /** Tooltip text. Rendered through `<Tooltip>` (not the native browser title). */
  tooltip?: string;
  /** Which side of the button the tooltip opens on. Defaults to `bottom`.
   *  Vertical toolbars should pass `right`/`left` so the tooltip doesn't
   *  cover the adjacent stacked button. */
  tooltipSide?: ButtonProps["tooltipSide"];
  /** Whether this button is in the active/selected state */
  active?: boolean;
  /** Override accent color when active (e.g. red for mute, amber for solo).
   *  Rendered as a solid fill (icon-shape convention). */
  activeColor?: string;
  /** Click handler. Receives the native MouseEvent so callers can call
   *  `stopPropagation()` when the button is nested inside another
   *  clickable surface (e.g. a row that opens on click). */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Size variant. `xs` is a compact 18px tile for letter glyphs in dense
   *  rows (mixer M/S capsules). */
  size?: "xs" | "sm" | "md" | "lg";
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Test ID for testing */
  testId?: string;
  /** Additional className */
  className?: string;
  /** Inline style overrides */
  style?: CSSProperties;
  /** Optional ref forwarded to the underlying <button> */
  ref?: Ref<HTMLButtonElement>;
  /** Optional aria-label override (defaults to `tooltip`). */
  "aria-label"?: string;
}

/**
 * Square-aspect glass-pill button. Thin preset around `Button` —
 * equivalent to `<Button shape="icon" size={size} ... />`. Kept as a
 * named export because the call sites read more clearly and the default
 * size differs from Button's (`lg` here, `md` there).
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    children,
    tooltip,
    tooltipSide,
    active,
    activeColor,
    onClick,
    size = "lg",
    disabled,
    testId,
    className,
    style,
    ...rest
  },
  ref,
) {
  return (
    <Button
      ref={ref}
      shape="icon"
      size={size}
      tooltip={tooltip}
      tooltipSide={tooltipSide}
      ariaLabel={rest["aria-label"] ?? tooltip}
      active={active}
      activeColor={activeColor}
      onClick={onClick}
      disabled={disabled}
      testId={testId}
      className={className}
      style={style}
    >
      {children}
    </Button>
  );
});
