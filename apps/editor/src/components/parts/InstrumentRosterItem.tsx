import type { Dispatch, SetStateAction, CSSProperties } from "react";
import type { Part, PartDisplayInfo } from "@viritura/core";
import type { ContextMenuState } from "@viritura/ui";
import { isPercussionPart } from "../../score/kitInput";
import type { KitComponentEdit } from "../DrumKitDialog";
import type { PartListPanelProps } from "../PartListPanel";
import { dropIndicatorStyle } from "./styles";
import { createInstrumentContextMenuHandler } from "./instrumentContextMenu";
import { RosterPartRow } from "./roster/RosterPartRow";

export interface InstrumentDropTarget {
  partId: string;
  after: boolean;
}

interface InstrumentRosterItemProps {
  part: Part;
  info?: PartDisplayInfo;
  expanded: boolean;
  canRemove: boolean;
  reorderable: boolean;
  dragPartId: string | null;
  dropTarget: InstrumentDropTarget | null;
  kitRows: readonly KitComponentEdit[] | null;
  onToggle: () => void;
  onUpdate: PartListPanelProps["onPartUpdate"];
  onChangeInstrument: (partId: string) => void;
  onEditDrumKit?: (partId: string) => void;
  onRemove: PartListPanelProps["onRemoveInstrument"];
  onDrop: () => void;
  setDragPartId: Dispatch<SetStateAction<string | null>>;
  setDropTarget: Dispatch<SetStateAction<InstrumentDropTarget | null>>;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
}

function rowWrapStyle(isDragging: boolean): CSSProperties {
  return { position: "relative", opacity: isDragging ? 0.4 : 1 };
}

export function InstrumentRosterItem({
  part,
  info,
  expanded,
  canRemove,
  reorderable,
  dragPartId,
  dropTarget,
  kitRows,
  onToggle,
  onUpdate,
  onChangeInstrument,
  onEditDrumKit,
  onRemove,
  onDrop,
  setDragPartId,
  setDropTarget,
  setContextMenu,
}: InstrumentRosterItemProps) {
  const draggable = reorderable && !!part.id && !expanded;
  const showBefore = !!part.id && dropTarget?.partId === part.id && !dropTarget.after && dragPartId !== part.id;
  const showAfter = !!part.id && dropTarget?.partId === part.id && dropTarget.after && dragPartId !== part.id;
  const menuHandler = part.id
    ? createInstrumentContextMenuHandler(
        {
          partId: part.id,
          isPercussion: isPercussionPart(part),
          canRemove,
          onChangeInstrument,
          onEditDrumKit,
          onRemove,
        },
        setContextMenu,
      )
    : undefined;

  return (
    <div
      style={rowWrapStyle(dragPartId === part.id)}
      draggable={draggable}
      onDragStart={
        draggable
          ? (event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", part.id ?? "");
              setDragPartId(part.id ?? null);
            }
          : undefined
      }
      onDragOver={
        reorderable && part.id
          ? (event) => {
              if (!dragPartId || dragPartId === part.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              setDropTarget({ partId: part.id!, after: event.clientY - rect.top > rect.height / 2 });
            }
          : undefined
      }
      onDrop={
        reorderable
          ? (event) => {
              event.preventDefault();
              onDrop();
            }
          : undefined
      }
      onDragEnd={() => {
        setDragPartId(null);
        setDropTarget(null);
      }}
    >
      {showBefore && <div style={dropIndicatorStyle} />}
      <RosterPartRow
        part={part}
        info={info}
        expanded={expanded}
        onToggle={onToggle}
        onUpdate={onUpdate}
        onContextMenu={menuHandler}
        onOpenMenu={menuHandler}
        kitRows={kitRows}
      />
      {showAfter && <div style={dropIndicatorStyle} />}
    </div>
  );
}
