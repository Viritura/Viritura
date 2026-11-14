import { useState } from "react";
import { LayoutPanelTop, Palette, SlidersHorizontal } from "lucide-react";
import { Tabs } from "@viritura/ui";
import { type PageSetup, type Score } from "@viritura/core";
import { ProjectPageSetup } from "../../../../pageSetup";
import { HouseStylePanel } from "../HouseStylePanel";
import { NotationInspector } from "../../../NotationInspector";
import { useSelection } from "../../../../store/selectionStore";
import { textFrameIdFromElementId } from "../../../../score/textFrameMutations";
import { InstrumentNameDisplayControl } from "../../../parts/InstrumentNameDisplayControl";
import {
  instrumentNameDisplayLayoutIds,
  type InstrumentNameDisplaySettings,
} from "../../../parts/instrumentNameDisplay";
import styles from "./EngraveLeftPanel.module.css";
import { BreakManagement } from "./BreakManagement";
import { AutoHideEmptyStavesControl } from "./AutoHideEmptyStavesControl";

interface EngraveLeftPanelProps {
  score: Score | null;
  activeScoreIndex: number;
  onApplyPageSetup: (setup: PageSetup) => void;
  onResetPageSetup: () => void;
  onInstrumentNameDisplayChange: (settings: InstrumentNameDisplaySettings) => void;
  onAutoHideEmptyPartsChange: (partIds: string[]) => void;
  selectedBreakKind: "system" | "page" | null;
  selectedAfterMeasureNumber?: number;
  hasLayoutOverrides: boolean;
  onRemoveSelectedBreak: () => void;
  onResetAll: () => void;
}

const TABS = [
  { id: "house-style", label: "House Style", icon: <Palette size={14} /> },
  { id: "layouts", label: "Layouts", icon: <LayoutPanelTop size={14} /> },
  { id: "properties", label: "Properties", icon: <SlidersHorizontal size={14} /> },
];

export function EngraveLeftPanel({
  score,
  activeScoreIndex,
  onApplyPageSetup,
  onResetPageSetup,
  onInstrumentNameDisplayChange,
  onAutoHideEmptyPartsChange,
  selectedBreakKind,
  selectedAfterMeasureNumber,
  hasLayoutOverrides,
  onRemoveSelectedBreak,
  onResetAll,
}: EngraveLeftPanelProps) {
  const selection = useSelection();
  const [tabChoice, setTabChoice] = useState<{ id: string; selection: typeof selection | null }>({
    id: "house-style",
    selection: null,
  });
  const selectedScore = score?.scores?.[activeScoreIndex];
  const frameSelected =
    selection.kind === "single" &&
    textFrameIdFromElementId(selection.elementId, selectedScore?.textFrames ?? []) !== null;
  const activeTab = frameSelected && tabChoice.selection !== selection ? "properties" : tabChoice.id;
  const selectedLayoutIds = selectedScore ? instrumentNameDisplayLayoutIds(selectedScore) : new Set<string>();
  const selectedLayout = score?.layouts?.find((layout) => selectedLayoutIds.has(layout.id));

  return (
    <aside className={styles.root} data-testid="engrave-left-panel">
      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={(id) => setTabChoice({ id, selection })} variant="panel">
        {activeTab === "house-style" ? (
          <HouseStylePanel />
        ) : activeTab === "layouts" ? (
          <div className={`viritura-scroll ${styles.layouts}`}>
            {selectedScore && score && (
              <section className={styles.selection}>
                <ProjectPageSetup
                  key={activeScoreIndex}
                  score={score}
                  scoreIndex={activeScoreIndex}
                  preamble={
                    <>
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
                      {score && (
                        <AutoHideEmptyStavesControl
                          score={score}
                          scoreIndex={activeScoreIndex}
                          onChange={onAutoHideEmptyPartsChange}
                        />
                      )}
                    </>
                  }
                  onApply={onApplyPageSetup}
                  onReset={onResetPageSetup}
                />
              </section>
            )}
          </div>
        ) : (
          <NotationInspector />
        )}
      </Tabs>
    </aside>
  );
}
