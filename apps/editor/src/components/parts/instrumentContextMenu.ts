import type { MouseEvent, MouseEventHandler } from "react";
import type { ContextMenuState, MenuItemDef } from "@viritura/ui";

export interface InstrumentContextMenuArgs {
  partId: string;
  isPercussion: boolean;
  canRemove: boolean;
  onChangeInstrument: (partId: string) => void;
  onEditDrumKit?: (partId: string) => void;
  onRemove?: (partId: string) => void;
}

export function instrumentContextMenuState(
  event: MouseEvent<HTMLButtonElement>,
  args: InstrumentContextMenuArgs,
): ContextMenuState {
  event.preventDefault();
  event.stopPropagation();
  const triggerBounds = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX || triggerBounds.right,
    y: event.clientY || triggerBounds.bottom,
    items: buildInstrumentContextMenuItems(args),
  };
}

export function createInstrumentContextMenuHandler(
  args: InstrumentContextMenuArgs,
  setState: (state: ContextMenuState) => void,
): MouseEventHandler<HTMLButtonElement> {
  return (event) => setState(instrumentContextMenuState(event, args));
}

export function buildInstrumentContextMenuItems({
  partId,
  isPercussion,
  canRemove,
  onChangeInstrument,
  onEditDrumKit,
  onRemove,
}: InstrumentContextMenuArgs): MenuItemDef[] {
  const items: MenuItemDef[] = [
    {
      label: "Change instrument",
      action: () => onChangeInstrument(partId),
    },
  ];
  if (isPercussion && onEditDrumKit) {
    items.push({
      label: "Edit percussion map",
      action: () => onEditDrumKit(partId),
    });
  }
  if (canRemove && onRemove) {
    items.push(
      { separator: true },
      {
        label: "Remove instrument",
        action: () => onRemove(partId),
      },
    );
  }
  return items;
}
