/**
 * SetupPanel — the left panel of Setup mode.
 *
 * Owns persistent project structure after creation: metadata, instruments,
 * and score/layout definitions. Opening musical conditions belong to the
 * New Project form; later musical changes belong to Write mode.
 */
import { useCallback, useState } from "react";
import { Tabs, type TabDef } from "@viritura/ui";
import { FileText, Users, LayoutGrid } from "lucide-react";
import { PartListPanel, type PartListPanelProps } from "../../PartListPanel";
import { ProjectMode } from "../../parts/ProjectMode";
import { InstrumentsMode } from "../../parts/InstrumentsMode";
import styles from "./SetupPanel.module.css";

type SetupTab = "project" | "instruments" | "scores";

const TAB_DEFS: TabDef[] = [
  { id: "project", label: "Project", icon: <FileText size={13} /> },
  { id: "instruments", label: "Instruments", icon: <Users size={13} /> },
  { id: "scores", label: "Scores", icon: <LayoutGrid size={13} /> },
];

export interface SetupPanelProps extends PartListPanelProps {
  /** Add every instrument of an ensemble template in one edit. */
  readonly onAddEnsemble?: (templateId: string) => void;
}

export function SetupPanel({ onAddEnsemble, ...props }: SetupPanelProps) {
  const [activeTab, setActiveTab] = useState<SetupTab>("instruments");
  const handleTabChange = useCallback((id: string) => setActiveTab(id as SetupTab), []);

  return (
    <div className={styles.root}>
      <Tabs tabs={TAB_DEFS} activeTab={activeTab} onTabChange={handleTabChange} className={styles.tabBar}>
        {activeTab === "project" && <ProjectMode />}
        {activeTab === "instruments" && <InstrumentsMode {...props} onAddEnsemble={onAddEnsemble} />}
        {activeTab === "scores" && <PartListPanel {...props} />}
      </Tabs>
    </div>
  );
}
