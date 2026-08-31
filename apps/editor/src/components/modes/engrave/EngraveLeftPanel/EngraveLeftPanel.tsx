import { useMemo, useState } from "react";
import { LayoutPanelTop, Palette, SlidersHorizontal } from "lucide-react";
import { Tabs } from "@viritura/ui";
import { defaultPageSetupForScore, type PageSetup, type Score } from "@viritura/core";
import { buildScoreEntries } from "../../../../scoreSwitcher/scoreEntries";
import { PageSetupDialog } from "../../../PageSetupDialog";
import { HouseStylePanel } from "../HouseStylePanel";
import { NotationInspector } from "../../../NotationInspector";
import styles from "./EngraveLeftPanel.module.css";

interface EngraveLeftPanelProps {
  score: Score | null;
  activeScoreIndex: number;
  onApplyPageSetup: (setup: PageSetup) => void;
  onResetPageSetup: () => void;
}

const TABS = [
  { id: "house-style", label: "House Style", icon: <Palette size={14} /> },
  { id: "layouts", label: "Layouts", icon: <LayoutPanelTop size={14} /> },
  { id: "properties", label: "Properties", icon: <SlidersHorizontal size={14} /> },
];

function formatMillimetres(value: number): string {
  return Number.isInteger(value) ? `${value} mm` : `${value.toFixed(1)} mm`;
}

export function EngraveLeftPanel({
  score,
  activeScoreIndex,
  onApplyPageSetup,
  onResetPageSetup,
}: EngraveLeftPanelProps) {
  const [activeTab, setActiveTab] = useState("house-style");
  const entries = useMemo(() => buildScoreEntries(score), [score]);
  const selected = entries.find((entry) => entry.index === activeScoreIndex);
  const defaults = defaultPageSetupForScore(score?.scores, activeScoreIndex, score?.layouts, score?.parts?.length);
  const stored = score?.scores?.[activeScoreIndex]?.pageSetup;
  const pageSetup = useMemo(
    () => (stored ? { ...defaults, ...stored, margins: { ...defaults.margins, ...stored.margins } } : defaults),
    [defaults, stored],
  );

  return (
    <aside className={styles.root} data-testid="engrave-left-panel">
      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === "house-style" ? (
          <HouseStylePanel />
        ) : activeTab === "layouts" ? (
          <div className={`viritura-scroll ${styles.layouts}`}>
            <div className={styles.intro}>Layout settings for the score or part selected in the header.</div>
            {selected && pageSetup && (
              <section className={styles.selection}>
                <div className={styles.selectionHeader}>
                  <strong>{selected.name}</strong>
                  <span>{selected.isScore ? "Score layout" : "Part layout"}</span>
                </div>
                <div className={styles.summary}>
                  {formatMillimetres(pageSetup.width)} × {formatMillimetres(pageSetup.height)} ·{" "}
                  {formatMillimetres(pageSetup.spatiumMm * 4)} staff
                </div>
                <PageSetupDialog
                  key={activeScoreIndex}
                  embedded
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
