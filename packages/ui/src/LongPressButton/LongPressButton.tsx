import { useCallback, useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import styles from "./LongPressButton.module.css";
import { Tooltip } from "../Tooltip/Tooltip";
import { Button } from "../Button/Button";

export interface LongPressOption {
  label: ReactNode;
  title: string;
  value: number | string;
}

export interface LongPressButtonProps {
  /** The icon/label to show on the main button */
  children: ReactNode;
  /** Tooltip for the main button */
  title: string;
  /** Options revealed on long press */
  options: LongPressOption[];
  /**
   * Currently selected option (always one of options[]). This is the value
   * the button toggles on/off — it is independent of `active` and never
   * cleared. Long-pressing and picking a different option moves it.
   */
  selectedValue: number | string;
  /** Whether the selected option is currently active (on). */
  active: boolean;
  /** Single-click flips `active` between true and false. */
  onToggle: () => void;
  /**
   * Called when the user picks a different option from the popup. The
   * caller is expected to update `selectedValue` AND (typically) set
   * `active` to true — picking an option always implies activation.
   */
  onSelectedChange: (value: number | string) => void;
  /** Whether to render label using Bravura font */
  useBravura?: boolean;
  /** Test ID */
  testId?: string;
}

const LONG_PRESS_DELAY = 300;
/** Keep the popover this many px away from any viewport edge. */
const COLLISION_PADDING = 8;

/**
 * Two-state toggle-with-picker button:
 * - `selectedValue` is always one of `options[]`. It represents the user's
 *   currently picked option — independent of whether it's switched on.
 * - `active` is the on/off bit applied to `selectedValue`.
 * - Single-click → fires `onToggle()` (caller flips `active`).
 * - Long press (300ms) or right-click → reveals the popup. Picking an option
 *   fires `onSelectedChange(value)`; the caller is expected to both update
 *   `selectedValue` and set `active = true`.
 *
 * Both the trigger and the popup option tiles are rendered through `Button`
 * — so glyph centering, sizing, and active-state visuals are consistent
 * with the rest of the design system. The Popover surface (background,
 * blur, collision-aware placement) is the only thing unique to this
 * component.
 */
export function LongPressButton({
  children,
  title,
  options,
  selectedValue,
  active,
  onToggle,
  onSelectedChange,
  useBravura,
  testId,
}: LongPressButtonProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleMouseDown = useCallback(() => {
    didLongPress.current = false;
    timerRef.current = setTimeout(() => {
      didLongPress.current = true;
      setOpen(true);
    }, LONG_PRESS_DELAY);
  }, []);

  const handleMouseUp = useCallback(() => {
    cancelLongPress();
    if (!didLongPress.current) onToggle();
  }, [cancelLongPress, onToggle]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // Right-click is the keyboard-friendly equivalent of a long press.
      e.preventDefault();
      cancelLongPress();
      didLongPress.current = true;
      setOpen(true);
    },
    [cancelLongPress],
  );

  const handleOptionClick = useCallback(
    (value: number | string) => {
      onSelectedChange(value);
      setOpen(false);
    },
    [onSelectedChange],
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* Force the trigger tooltip closed whenever the popover is open —
       *  otherwise the still-visible tooltip can sit on top of the popup
       *  options and intercept clicks. */}
      <Tooltip content={title} open={open ? false : undefined}>
        <Popover.Anchor asChild>
          <Button
            ariaLabel={title}
            active={active}
            useBravura={useBravura}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onContextMenu={handleContextMenu}
            testId={testId}
            aria-haspopup="menu"
            aria-expanded={open}
            className={styles.trigger}
          >
            {children}
            <span className={styles.caret} aria-hidden="true" />
          </Button>
        </Popover.Anchor>
      </Tooltip>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="center"
          sideOffset={8}
          collisionPadding={COLLISION_PADDING}
          className={styles.popup}
          // Don't steal focus from the trigger when the long-press opens
          // the popup — the user is still mid-gesture.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {options.map((opt) => (
            <Tooltip key={opt.value} content={opt.title}>
              <Button
                shape="icon"
                size="lg"
                ariaLabel={opt.title}
                active={selectedValue === opt.value}
                useBravura={useBravura}
                onClick={() => handleOptionClick(opt.value)}
              >
                {opt.label}
              </Button>
            </Tooltip>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
