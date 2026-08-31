// Design tokens & CSS reset (import in your app's entry point):
// import "@viritura/ui/tokens.css";
// import "@viritura/ui/reset.css";

// ── Foundational Primitives ──
export { Text, type TextProps, type TextVariant, type TextTone } from "./Text/Text";
export { Button, type ButtonProps } from "./Button/Button";
export { IconButton, type IconButtonProps } from "./IconButton/IconButton";
export {
  PaletteButton,
  CenteredGlyph,
  type PaletteButtonProps,
  type PaletteButtonSelectionMode,
  type PaletteButtonShape,
} from "./PaletteButton";
export { Badge, type BadgeProps } from "./Badge/Badge";
export { Checkbox, type CheckboxProps } from "./Checkbox/Checkbox";
export { Switch, type SwitchProps, type SwitchSize } from "./Switch/Switch";
export { Radio, RadioGroup, type RadioProps, type RadioGroupProps } from "./Radio/Radio";
export { Separator, type SeparatorProps } from "./Separator/Separator";
export { ActionTile, type ActionTileProps } from "./ActionTile/ActionTile";
export { ListRow, type ListRowProps } from "./ListRow/ListRow";
export { LongPressButton, type LongPressButtonProps, type LongPressOption } from "./LongPressButton/LongPressButton";

// ── Layout Components ──
export {
  Panel,
  usePanelState,
  type PanelProps,
  type PanelSide,
  type PanelState,
  type PanelStateOptions,
} from "./Panel";
export { WorkspaceShell, type WorkspaceShellProps, type WorkspaceInsets } from "./WorkspaceShell";

// ── Composite Components ──
export { Tabs, type TabsProps, type TabDef } from "./Tabs/Tabs";
export { Collapsible, type CollapsibleProps } from "./Collapsible/Collapsible";
export { PanelHeader, PanelActionButton, type PanelHeaderProps } from "./PanelHeader/PanelHeader";
export { SectionLabel, type SectionLabelProps } from "./SectionLabel/SectionLabel";
export { GlassCard, type GlassCardProps } from "./GlassCard/GlassCard";
export { Paper, type PaperProps } from "./Paper/Paper";
export { Sphere, type SphereProps } from "./Sphere/Sphere";
export {
  FormField,
  FormInput,
  FormTextarea,
  type FormFieldProps,
  type FormInputProps,
  type FormTextareaProps,
} from "./FormField/FormField";
export { FolderPickerInput, type FolderPickerInputProps } from "./FormField/FolderPickerInput";
export { Section, type SectionProps } from "./Section/Section";
export {
  SettingsRow,
  type SettingsRowProps,
  type SettingsRowIds,
  type SettingsRowLayout,
} from "./SettingsRow/SettingsRow";
export {
  NavList,
  nextNavItemId,
  flattenNavItems,
  type NavListProps,
  type NavListGroup,
  type NavListItem,
} from "./NavList";

// ── Menu System ──
export {
  MenuItem,
  type MenuItemProps,
  type MenuItemDef,
  ContextMenu,
  type ContextMenuProps,
  type ContextMenuState,
} from "./Menu/index";
export { RadialMenu, type RadialMenuProps } from "./RadialMenu";
export { filterRadialMenuItems, type RadialMenuItem } from "./RadialMenu";
export { TextPopover, type TextPopoverProps } from "./TextPopover/TextPopover";
export { CascadingMenu, type CascadingMenuItem, type CascadingMenuProps } from "./CascadingMenu";

// ── Dialog System ──
export {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogBody,
  DialogActions,
  DialogCancelButton,
  DialogSecondaryButton,
  DialogPrimaryButton,
  PromptDialog,
  DialogSplitBody,
  DialogSplitAside,
  DialogSplitMain,
  DialogSplitMainHeader,
  type DialogProps,
  type DialogSize,
  type PromptDialogProps,
} from "./Dialog";

// ── Form Controls ──
export { Slider, type SliderProps } from "./Slider/Slider";
export { Select, type SelectProps, type SelectOption } from "./Select/Select";
export { SearchInput, type SearchInputProps, type SearchInputSize } from "./SearchInput/SearchInput";
export { ButtonGroup, type ButtonGroupProps, type ButtonGroupOption } from "./ButtonGroup/ButtonGroup";
export { Tooltip, TooltipPrimitives, type TooltipProps } from "./Tooltip/Tooltip";
export { withTooltip } from "./Tooltip/withTooltip";

// ── Status surface ──
export {
  StatusBar,
  StatusSelect,
  StatusZoomControls,
  WriteStatusBar,
  PreviewStatusBar,
  type StatusBarProps,
  type StatusSelectOption,
  type StatusSelectProps,
  type StatusZoomControlsProps,
  type WriteStatusBarProps,
  type WriteViewMode,
  type PreviewStatusBarProps,
  type PreviewViewMode,
} from "./StatusBar";
export {
  VirituraLogo,
  VirituraMark,
  VirituraWordmark,
  type VirituraLogoProps,
  type VirituraMarkProps,
  type VirituraWordmarkProps,
} from "./BrandLogo";

// ── Error Handling ──
export { ErrorBoundary, type ErrorBoundaryProps } from "./ErrorBoundary";
