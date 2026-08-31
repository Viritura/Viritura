import {
  forwardRef,
  useCallback,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import styles from "./Button.module.css";
import { BravuraGlyph } from "../BravuraGlyph";
import { withTooltip } from "../Tooltip/withTooltip";
import type { TooltipProps } from "../Tooltip/Tooltip";

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "title" | "aria-label" | "disabled" | "className" | "children" | "type" | "style"
> {
  /** Button content */
  children?: ReactNode;
  /** Display label (used when children is not provided) */
  label?: string;
  /** Tooltip text. Rendered through `<Tooltip>` (not the native browser title). */
  tooltip?: string;
  /** Which side of the button the tooltip opens on. Defaults to `bottom`.
   *  Vertical toolbars (e.g. the activity bar) should pass `right`/`left`
   *  so the tooltip doesn't cover the adjacent stacked button. */
  tooltipSide?: TooltipProps["side"];
  /** Whether this button is in the active/pressed state */
  active?: boolean;
  /** Native button behavior. Defaults to `button` to avoid accidental form submission. */
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  /** Override accent color when active.
   *  - `shape="pill"` (default): rendered as an inset accent border.
   *  - `shape="icon"`: rendered as a solid fill (mute red / solo amber). */
  activeColor?: string;
  /** Click handler */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Optional aria-label override */
  ariaLabel?: string;
  /** Render label using Bravura font (for SMuFL glyphs) */
  useBravura?: boolean;
  /** How to vertically align Bravura glyphs:
   *  - "center" (default): visually centre each glyph's bbox in the button
   *  - "baseline": use a shared notehead-anchored offset so noteheads line up
   *    across heterogeneous glyphs (used by the duration row) */
  bravuraAlign?: "center" | "baseline";
  /** Override the Bravura font-size for this button (CSS value, e.g. "1.5rem") */
  bravuraSize?: string;
  /** Size variant. `xs` is an 18px tile reserved for `shape="icon"` (mixer
   *  M/S capsules); on `shape="pill"` it falls back to `sm` proportions. */
  size?: "xs" | "sm" | "md" | "lg";
  /** Visual variant:
   *  - default: glass pill (most contexts)
   *  - ghost:   transparent, hover-tint only (toolbars, dense rows)
   *  - primary: solid accent fill for emphasis CTAs outside dialogs
   *  - cta:     text-led activation action for onboarding and empty states
   *  - link:    text-only with underline-on-hover for inline actions
   *  - link-row: full-width navigation row with underlined link content
   *  - utility-row: full-width neutral row for account and disclosure actions
   *  - danger:  transparent with red-tinted hover (destructive actions like "Remove")
   */
  variant?: "default" | "ghost" | "primary" | "cta" | "link" | "link-row" | "utility-row" | "danger";
  /** Visual shape:
   *  - "pill" (default): content-sized rounded rectangle with padding.
   *  - "icon": fixed square aspect, no horizontal padding. For single-glyph
   *    buttons (toolbar mute, palette filters, long-press option tiles).
   *    Replaces the old standalone IconButton. */
  shape?: "pill" | "icon";
  /** Stretch to fill the parent's inline-axis width. */
  fullWidth?: boolean;
  /**
   * Expand the interaction box into a padded container's inline gutter while
   * keeping the button content aligned with neighboring controls.
   * Intended for full-width row variants such as `link-row`.
   */
  bleedInline?: boolean;
  /** Test ID for testing */
  testId?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Additional className */
  className?: string;
  /** Inline style overrides (merged after the primitive's own activeColor styles). */
  style?: CSSProperties;
  /** Optional ref forwarded to the underlying <button> (needed for Radix asChild). */
  ref?: Ref<HTMLButtonElement>;
}

function buttonClassName({
  size,
  variant,
  shape,
  fullWidth,
  bleedInline,
  useBravura,
  className,
}: Pick<ButtonProps, "size" | "variant" | "shape" | "fullWidth" | "bleedInline" | "useBravura" | "className">) {
  return [
    styles.button,
    size !== "md" ? styles[size!] : "",
    variant !== "default" ? styles[variant!] : "",
    shape === "icon" ? styles.iconShape : "",
    fullWidth ? styles.fullWidth : "",
    bleedInline ? styles.bleedInline : "",
    useBravura ? styles.bravura : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function activeButtonStyle(
  active: boolean | undefined,
  activeColor: string | undefined,
  shape: ButtonProps["shape"],
): CSSProperties | undefined {
  if (!active || !activeColor) return undefined;
  if (shape === "icon") {
    return { background: activeColor, borderColor: activeColor, color: "#fff" };
  }
  return {
    background: "var(--surface-raised)",
    boxShadow: `var(--inset-strong), inset 0 0 0 1.5px ${activeColor}`,
    color: activeColor,
  };
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    label,
    tooltip,
    tooltipSide,
    active,
    type = "button",
    activeColor,
    onClick,
    ariaLabel,
    useBravura = false,
    bravuraAlign = "center",
    bravuraSize,
    size = "md",
    variant = "default",
    shape = "pill",
    fullWidth = false,
    bleedInline = false,
    testId,
    disabled = false,
    className,
    style,
    ...rest
  },
  ref,
) {
  const tip = tooltip;
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;
      onClick?.(e);
    },
    [onClick, disabled],
  );

  const classNames = buttonClassName({ size, variant, shape, fullWidth, bleedInline, useBravura, className });

  // `activeColor` semantics differ by shape:
  //   - pill: render as an inset accent border (preserves the glass surface).
  //   - icon: render as a solid fill (the absorbed IconButton convention —
  //     used for mute red / solo amber capsules where the colour must read
  //     at 18px). Both honour user-provided `style` overrides.
  const inlineStyle = activeButtonStyle(active, activeColor, shape);

  const content = children ?? label;
  const renderedContent =
    useBravura && typeof content === "string" ? (
      <BravuraGlyph align={bravuraAlign} fontSize={bravuraSize} size={size}>
        {content}
      </BravuraGlyph>
    ) : (
      content
    );

  return withTooltip(
    <button
      ref={ref}
      className={classNames}
      style={inlineStyle ? { ...inlineStyle, ...style } : style}
      aria-label={ariaLabel ?? tip}
      {...(active === undefined ? {} : { "aria-pressed": active, "data-active": active })}
      onClick={handleClick}
      data-testid={testId}
      disabled={disabled}
      type={type}
      {...rest}
    >
      {renderedContent}
    </button>,
    tip,
    tooltipSide,
  );
});
