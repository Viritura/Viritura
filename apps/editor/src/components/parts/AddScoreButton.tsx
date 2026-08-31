import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Plus } from "lucide-react";
import { Button, ListRow } from "@viritura/ui";
import type { Part, PartDisplayInfo } from "@viritura/core";
import { addScoreDropdownStyle } from "./styles";

const ADD_SCORE_WRAPPER_STYLE: CSSProperties = { position: "relative" };

export interface AddScoreButtonProps {
  parts: readonly Part[];
  partDisplayMap: Map<string, PartDisplayInfo>;
  onAddScore: (type: "full" | "condensed" | "custom" | "part", partId?: string) => void;
  /** Open the multi-select picker to build a new section score. */
  onAddSectionScore?: () => void;
}

export function AddScoreButton({ parts, partDisplayMap, onAddScore, onAddSectionScore }: AddScoreButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div style={ADD_SCORE_WRAPPER_STYLE}>
      <Button onClick={() => setOpen((v) => !v)} tooltip="Add a score" size="sm" active={open}>
        <Plus size={11} /> Add Score
      </Button>
      {open && (
        <div ref={ref} style={addScoreDropdownStyle}>
          <ListRow
            density="compact"
            onClick={() => {
              onAddScore("full");
              setOpen(false);
            }}
          >
            Full Score
          </ListRow>
          <ListRow
            density="compact"
            onClick={() => {
              onAddScore("condensed");
              setOpen(false);
            }}
          >
            Condensed Score
          </ListRow>
          <ListRow
            density="compact"
            onClick={() => {
              onAddScore("custom");
              setOpen(false);
            }}
          >
            Custom Score
          </ListRow>
          {onAddSectionScore && (
            <ListRow
              density="compact"
              onClick={() => {
                onAddSectionScore();
                setOpen(false);
              }}
            >
              Section Score…
            </ListRow>
          )}
          {parts.map((p) => {
            const info = partDisplayMap.get(p.id ?? "");
            return (
              <ListRow
                key={p.id}
                density="compact"
                onClick={() => {
                  onAddScore("part", p.id);
                  setOpen(false);
                }}
              >
                Part: {info?.displayName ?? p.name ?? p.id}
              </ListRow>
            );
          })}
        </div>
      )}
    </div>
  );
}
