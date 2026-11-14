import { useCallback, useState, type ComponentProps } from "react";
import { PalettePanel } from "./PalettePanel";
import { ClipboardHistoryPanel } from "./ClipboardHistoryPanel";
import { NotationInspector } from "./NotationInspector";
import { LayoutGrid, ClipboardList, SlidersHorizontal } from "lucide-react";
import { Tabs, type TabDef } from "@viritura/ui";
import styles from "./LeftPanel.module.css";

export type WriteLeftTab = "palettes" | "clipboard" | "properties";

const TAB_DEFS: TabDef[] = [
  { id: "palettes", label: "Palettes", icon: <LayoutGrid size={13} /> },
  { id: "clipboard", label: "History", icon: <ClipboardList size={13} /> },
  { id: "properties", label: "Properties", icon: <SlidersHorizontal size={13} /> },
];

interface LeftPanelProps {
  preferredInspectorSection?: NonNullable<ComponentProps<typeof NotationInspector>>["preferredSection"];
  activeTab?: WriteLeftTab;
  onActiveTabChange?: (tab: WriteLeftTab) => void;
  paletteSectionRequest?: { id: string; requestId: number } | null;
  /** Show the Horizon text-frame lists in the Properties tab. */
  horizonTextFrames?: boolean;
  getCurrentPageIndex?: () => number;
}

export function LeftPanel({
  preferredInspectorSection,
  activeTab: controlledTab,
  onActiveTabChange,
  paletteSectionRequest,
  horizonTextFrames,
  getCurrentPageIndex,
}: LeftPanelProps = {}) {
  const [localTab, setLocalTab] = useState<WriteLeftTab>("palettes");
  const activeTab = controlledTab ?? localTab;
  const handleTabChange = useCallback(
    (id: string) => {
      const tab = id as WriteLeftTab;
      if (onActiveTabChange) onActiveTabChange(tab);
      else setLocalTab(tab);
    },
    [onActiveTabChange],
  );

  return (
    <div className={styles.container}>
      <Tabs tabs={TAB_DEFS} activeTab={activeTab} onTabChange={handleTabChange} variant="panel">
        {activeTab === "palettes" && (
          <PalettePanel
            openSectionRequest={paletteSectionRequest}
            getCurrentPageIndex={getCurrentPageIndex}
            onTextFrameCreated={() => handleTabChange("properties")}
            onOpenLyricsProperties={() => handleTabChange("properties")}
          />
        )}
        {activeTab === "clipboard" && <ClipboardHistoryPanel />}
        {activeTab === "properties" && (
          <NotationInspector
            preferredSection={preferredInspectorSection}
            horizonTextFrames={horizonTextFrames}
            showLyricLineControls
          />
        )}
      </Tabs>
    </div>
  );
}
