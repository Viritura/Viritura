/**
 * SetupPanel — the left panel of Setup mode.
 *
 * Consolidates what used to be split between the New Score wizard (a modal
 * operating on a throwaway `Player[]` draft) and Write mode's Musicians tab
 * (buried two tab bars deep). Every tab here edits the live score, so the
 * shared `ScoreCanvas` next to it re-renders on each change — which is the
 * whole point of the mode.
 */
import { useCallback, useState } from "react";
import { Tabs, type TabDef } from "@viritura/ui";
import { FileText, Music, Users, LayoutGrid } from "lucide-react";
import { PartListPanel, type PartListPanelProps } from "../../PartListPanel";
import { ProjectMode } from "../../parts/ProjectMode";
import { InstrumentsMode } from "../../parts/InstrumentsMode";
import { MusicTab } from "./MusicTab";
import styles from "./SetupPanel.module.css";

type SetupTab = "project" | "music" | "instruments" | "scores";

const TAB_DEFS: TabDef[] = [
  { id: "project", label: "Project", icon: <FileText size={13} /> },
  { id: "music", label: "Music", icon: <Music size={13} /> },
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
        {activeTab === "music" && <MusicTab />}
        {activeTab === "instruments" && <InstrumentsMode {...props} onAddEnsemble={onAddEnsemble} />}
        {activeTab === "scores" && <PartListPanel {...props} />}
      </Tabs>
    </div>
  );
}
