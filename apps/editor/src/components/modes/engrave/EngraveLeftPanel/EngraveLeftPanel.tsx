import { useState } from "react";
import { LayoutPanelTop, SlidersHorizontal } from "lucide-react";
import { Tabs } from "@viritura/ui";
import type { Score } from "@viritura/core";
import { NotationInspector } from "../../../NotationInspector";
import { useSelection } from "../../../../store/selectionStore";
import { textFrameIdFromElementId } from "../../../../score/textFrameMutations";
import { InstrumentNameDisplayControl } from "../../../parts/InstrumentNameDisplayControl";
import {
  instrumentNameDisplayLayoutIds,
  type InstrumentNameDisplaySettings,
} from "../../../parts/instrumentNameDisplay";
import { HouseStyleMode, LayoutStylePanel, useStyleEditorStore } from "../StyleEditor";
import styles from "./EngraveLeftPanel.module.css";
import { BreakManagement } from "./BreakManagement";
import { AutoHideEmptyStavesControl } from "./AutoHideEmptyStavesControl";
import type { AutoHideEmptyStavesChange } from "../../../../score/ScoreMutations";

interface EngraveLeftPanelProps {
  score: Score | null;
  activeScoreIndex: number;
  onInstrumentNameDisplayChange: (settings: InstrumentNameDisplaySettings) => void;
  onAutoHideEmptyPartsChange: (change: AutoHideEmptyStavesChange) => void;
  selectedBreakKind: "system" | "page" | null;
  selectedAfterMeasureNumber?: number;
  hasLayoutOverrides: boolean;
  onRemoveSelectedBreak: () => void;
  onResetAll: () => void;
}

const TABS = [
  { id: "layout", label: "Layout", icon: <LayoutPanelTop size={14} /> },
  { id: "selection", label: "Selection", icon: <SlidersHorizontal size={14} /> },
];

export function EngraveLeftPanel({
  score,
  activeScoreIndex,
  onInstrumentNameDisplayChange,
  onAutoHideEmptyPartsChange,
  selectedBreakKind,
  selectedAfterMeasureNumber,
  hasLayoutOverrides,
  onRemoveSelectedBreak,
  onResetAll,
}: EngraveLeftPanelProps) {
  const selection = useSelection();
  const mode = useStyleEditorStore((state) => state.mode);
  const layoutTab = useStyleEditorStore((state) => state.layoutTab);
  const openLayout = useStyleEditorStore((state) => state.openLayout);
  const openSelection = useStyleEditorStore((state) => state.openSelection);
  // A newly selected text frame shows its properties until the user picks a tab again.
  const [choiceSelection, setChoiceSelection] = useState<typeof selection | null>(null);
  const selectedScore = score?.scores?.[activeScoreIndex];
  const frameSelected =
    selection.kind === "single" &&
    textFrameIdFromElementId(selection.elementId, selectedScore?.textFrames ?? []) !== null;
  const activeTab = frameSelected && choiceSelection !== selection ? "selection" : layoutTab;
  const selectedLayoutIds = selectedScore ? instrumentNameDisplayLayoutIds(selectedScore) : new Set<string>();
  const selectedLayout = score?.layouts?.find((layout) => selectedLayoutIds.has(layout.id));

  if (score && mode === "house") {
    return (
      <aside className={styles.root} data-testid="engrave-left-panel">
        <HouseStyleMode score={score} scoreIndex={activeScoreIndex} />
      </aside>
    );
  }

  const systems = selectedScore && score && (
    <div className={styles.systems}>
      <BreakManagement
        selectedBreakKind={selectedBreakKind}
        selectedAfterMeasureNumber={selectedAfterMeasureNumber}
        hasLayoutOverrides={hasLayoutOverrides}
        onRemoveSelectedBreak={onRemoveSelectedBreak}
        onResetAll={onResetAll}
      />
      {selectedLayout && (
        <InstrumentNameDisplayControl
          content={selectedLayout.content}
          score={selectedScore}
          onChange={onInstrumentNameDisplayChange}
        />
      )}
      <AutoHideEmptyStavesControl score={score} scoreIndex={activeScoreIndex} onChange={onAutoHideEmptyPartsChange} />
    </div>
  );

  return (
    <aside className={styles.root} data-testid="engrave-left-panel">
      <Tabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(id) => {
          setChoiceSelection(selection);
          if (id === "selection") openSelection();
          else openLayout();
        }}
        variant="panel"
      >
        {activeTab === "layout" ? (
          <div className={`viritura-scroll ${styles.layouts}`}>
            {score && selectedScore ? (
              <LayoutStylePanel score={score} scoreIndex={activeScoreIndex} systems={systems} />
            ) : (
              <p className={styles.empty}>Open a score to adjust its layout.</p>
            )}
          </div>
        ) : (
          <NotationInspector />
        )}
      </Tabs>
    </aside>
  );
}
