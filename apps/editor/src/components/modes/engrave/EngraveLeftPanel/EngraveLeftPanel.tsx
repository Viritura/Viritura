import { useMemo, useState } from "react";
import { LayoutPanelTop, Palette, SlidersHorizontal } from "lucide-react";
import { Tabs } from "@viritura/ui";
import { defaultPageSetupForScore, type PageSetup, type Score } from "@viritura/core";
import { PageSetupDialog } from "../../../PageSetupDialog";
import { HouseStylePanel } from "../HouseStylePanel";
import { NotationInspector } from "../../../NotationInspector";
import { InstrumentNameDisplayControl } from "../../../parts/InstrumentNameDisplayControl";
import {
  instrumentNameDisplayLayoutIds,
  type InstrumentNameDisplaySettings,
} from "../../../parts/instrumentNameDisplay";
import styles from "./EngraveLeftPanel.module.css";
import { BreakManagement } from "./BreakManagement";

interface EngraveLeftPanelProps {
  score: Score | null;
  activeScoreIndex: number;
  onApplyPageSetup: (setup: PageSetup) => void;
  onResetPageSetup: () => void;
  onInstrumentNameDisplayChange: (settings: InstrumentNameDisplaySettings) => void;
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
  selectedBreakKind,
  selectedAfterMeasureNumber,
  hasLayoutOverrides,
  onRemoveSelectedBreak,
  onResetAll,
}: EngraveLeftPanelProps) {
  const [activeTab, setActiveTab] = useState("house-style");
  const defaults = defaultPageSetupForScore(score?.scores, activeScoreIndex, score?.layouts, score?.parts?.length);
  const stored = score?.scores?.[activeScoreIndex]?.pageSetup;
  const selectedScore = score?.scores?.[activeScoreIndex];
  const selectedLayoutIds = selectedScore ? instrumentNameDisplayLayoutIds(selectedScore) : new Set<string>();
  const selectedLayout = score?.layouts?.find((layout) => selectedLayoutIds.has(layout.id));
  const pageSetup = useMemo(
    () => (stored ? { ...defaults, ...stored, margins: { ...defaults.margins, ...stored.margins } } : defaults),
    [defaults, stored],
  );

  return (
    <aside className={styles.root} data-testid="engrave-left-panel">
      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} variant="panel">
        {activeTab === "house-style" ? (
          <HouseStylePanel />
        ) : activeTab === "layouts" ? (
          <div className={`viritura-scroll ${styles.layouts}`}>
            {selectedScore && pageSetup && (
              <section className={styles.selection}>
                <PageSetupDialog
                  key={activeScoreIndex}
                  embedded
                  embeddedPreamble={
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
                    </>
                  }
                  initialSetup={pageSetup}
                  onApply={onApplyPageSetup}
                  onResetToDefault={onResetPageSetup}
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
