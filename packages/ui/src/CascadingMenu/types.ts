export interface CascadingMenuItem {
  readonly id: string;
  readonly label?: string;
  readonly onSelect?: () => void;
  readonly disabled?: boolean;
  readonly separator?: boolean;
  readonly children?: readonly CascadingMenuItem[];
}

export interface CascadingMenuProps {
  /** Accessible name of the menu trigger. */
  readonly ariaLabel: string;
  /** Text shown in the menu trigger. */
  readonly label: string;
  /** Hierarchical choices presented by the menu. */
  readonly items: readonly CascadingMenuItem[];
  /** Additional class for the trigger. */
  readonly className?: string;
  /**
   * Stretch the trigger to fill its container's width. Defaults to `true` (the
   * Mixer sound picker fills its column); pass `false` for a compact,
   * content-sized trigger (e.g. an inline "+ Add" button in a toolbar row).
   */
  readonly triggerFullWidth?: boolean;
  /** Size of the trigger button. Defaults to the Button primitive's medium size. */
  readonly triggerSize?: "xs" | "sm" | "md" | "lg";
}
