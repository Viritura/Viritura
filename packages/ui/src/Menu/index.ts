export interface MenuItemDef {
  readonly label?: string;
  readonly shortcut?: string;
  readonly action?: (() => void) | undefined;
  readonly disabled?: boolean;
  readonly separator?: boolean;
  readonly children?: readonly MenuItemDef[];
}

export { MenuItem, type MenuItemProps } from "./MenuItem";
export { ContextMenu, type ContextMenuProps, type ContextMenuState } from "./ContextMenu";
