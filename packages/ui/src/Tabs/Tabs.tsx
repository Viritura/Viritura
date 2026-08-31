import { useState, type ReactNode } from "react";
import styles from "./Tabs.module.css";

export interface TabDef {
  /** Unique key for this tab */
  id: string;
  /** Tab label text */
  label: string;
  /** Optional icon element */
  icon?: ReactNode;
}

export interface TabsProps {
  /** Tab definitions */
  tabs: TabDef[];
  /** Currently active tab id */
  activeTab?: string;
  /** Default active tab id (uncontrolled mode) */
  defaultTab?: string;
  /** Called when a tab is selected */
  onTabChange?: (id: string) => void;
  /** Called when the pointer enters a tab button (useful for preloading) */
  onTabHover?: (id: string) => void;
  /** Content to render for the active tab */
  children?: ReactNode;
  /** Additional className for the tab bar */
  className?: string;
}

export function Tabs({
  tabs,
  activeTab: controlledTab,
  defaultTab,
  onTabChange,
  onTabHover,
  children,
  className,
}: TabsProps) {
  const [internalTab, setInternalTab] = useState(defaultTab ?? tabs[0]?.id ?? "");
  const activeTab = controlledTab ?? internalTab;

  const handleTabClick = (id: string) => {
    if (controlledTab === undefined) setInternalTab(id);
    onTabChange?.(id);
  };

  return (
    <>
      <div className={`${styles.tabBar} ${className ?? ""}`} role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={styles.tabButton}
            onClick={() => handleTabClick(tab.id)}
            onMouseEnter={onTabHover ? () => onTabHover(tab.id) : undefined}
            onFocus={onTabHover ? () => onTabHover(tab.id) : undefined}
            aria-selected={activeTab === tab.id}
            role="tab"
          >
            {tab.icon && <span className={styles.tabIcon}>{tab.icon}</span>}
            <span className={styles.tabLabel}>{tab.label}</span>
          </button>
        ))}
      </div>
      <div className={styles.tabContent} role="tabpanel">
        {children}
      </div>
    </>
  );
}
