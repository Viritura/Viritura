import { Settings } from "lucide-react";
import { IconButton } from "@viritura/ui";
import { AccountButton } from "../auth";
import { LiveActivityButton } from "../live/LiveActivityButton";
import { McpActivityButton } from "../mcpSession";
import { ACTIVITY_DEFINITIONS, type ActivityView } from "./activityRegistry";
import styles from "./ActivityBar.module.css";

export type { ActivityView } from "./activityRegistry";

interface ActivityBarProps {
  activeView: ActivityView;
  onViewChange: (view: ActivityView) => void;
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
  onOpenAccountSettings: () => void;
}

export function ActivityBar({
  activeView,
  onViewChange,
  settingsOpen = false,
  onToggleSettings,
  onOpenAccountSettings,
}: ActivityBarProps) {
  return (
    <div className={`${styles.bar} app-chrome app-chrome--side`}>
      {ACTIVITY_DEFINITIONS.map((item) => {
        const Icon = item.icon;
        return (
          <IconButton
            key={item.view}
            active={activeView === item.view}
            onClick={() => onViewChange(item.view)}
            tooltip={item.label}
            tooltipSide="right"
          >
            <Icon size={20} />
          </IconButton>
        );
      })}
      <div className={styles.bottomActions}>
        <McpActivityButton />
        <LiveActivityButton />
        <AccountButton onOpenSettings={onOpenAccountSettings} />
        <IconButton tooltip="Settings" tooltipSide="right" active={settingsOpen} onClick={onToggleSettings}>
          <Settings size={20} />
        </IconButton>
      </div>
    </div>
  );
}
