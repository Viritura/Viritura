import { useCallback, useState, type ComponentProps } from "react";
import { PalettePanel } from "./PalettePanel";
import { ClipboardHistoryPanel } from "./ClipboardHistoryPanel";
import { NotationInspector } from "./NotationInspector";
import { LayoutGrid, ClipboardList, SlidersHorizontal } from "lucide-react";
import { Tabs, type TabDef } from "@viritura/ui";
import { useHistoryStore } from "../store/historyStore";
import styles from "./LeftPanel.module.css";

type LeftTab = "palettes" | "clipboard" | "properties";

const TAB_DEFS: TabDef[] = [
  { id: "palettes", label: "Palettes", icon: <LayoutGrid size={13} /> },
  { id: "clipboard", label: "History", icon: <ClipboardList size={13} /> },
  { id: "properties", label: "Properties", icon: <SlidersHorizontal size={13} /> },
];

interface LeftPanelProps {
  preferredInspectorSection?: NonNullable<ComponentProps<typeof NotationInspector>>["preferredSection"];
}

export function LeftPanel({ preferredInspectorSection }: LeftPanelProps = {}) {
  const [activeTab, setActiveTab] = useState<LeftTab>("palettes");
  const preloadDescriptions = useHistoryStore((s) => s.preloadDescriptions);

  // Hover-preload undo descriptions when the user is about to open the Clips
  // tab (Next.js-style link prefetch). By the time they click, descriptions
  // are computed and the panel renders without shimmer.
  const handleTabHover = useCallback(
    (id: string) => {
      if (id === "clipboard") {
        // Defer to a microtask so we don't block hover paint.
        queueMicrotask(() => preloadDescriptions());
      }
    },
    [preloadDescriptions],
  );

  return (
    <div className={styles.container}>
      <Tabs
        tabs={TAB_DEFS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as LeftTab)}
        onTabHover={handleTabHover}
        className={styles.tabBar}
      >
        {activeTab === "palettes" && <PalettePanel />}
        {activeTab === "clipboard" && <ClipboardHistoryPanel />}
        {activeTab === "properties" && <NotationInspector preferredSection={preferredInspectorSection} />}
      </Tabs>
    </div>
  );
}
