import type { CSSProperties, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Collapsible } from "@viritura/ui";

export interface SortablePaletteSectionProps {
  id: string;
  title: string;
  shortcut?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * A draggable wrapper around the `Collapsible` palette section.
 *
 * The entire row is the drag activator — there is no separate handle.
 * The PointerSensor's 4px activation distance (configured in
 * `PalettePanel`) keeps short clicks on the Collapsible chevron from
 * being mistaken for drags.
 */
export function SortablePaletteSection({
  id,
  title,
  shortcut,
  open,
  onOpenChange,
  children,
}: SortablePaletteSectionProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const rowStyle: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative",
    zIndex: isDragging ? 2 : undefined,
    cursor: isDragging ? "grabbing" : "grab",
  };

  return (
    <div ref={setNodeRef} style={rowStyle} className="viritura-palette-row" {...attributes} {...listeners}>
      <Collapsible title={title} shortcut={shortcut} open={open} onOpenChange={onOpenChange}>
        {children}
      </Collapsible>
    </div>
  );
}
