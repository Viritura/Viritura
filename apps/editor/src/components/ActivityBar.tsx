import { Settings } from "lucide-react";
import { Button, IconButton } from "@viritura/ui";
import { AccountButton } from "../auth";
import { LiveActivityButton } from "../live/LiveActivityButton";
import { McpActivityButton } from "../mcpSession";
import { ACTIVITY_DEFINITIONS, type ActivityView } from "./activityRegistry";
import styles from "./ActivityBar.module.css";

export type { ActivityView } from "./activityRegistry";

interface ActivityBarProps {
  hidden?: boolean;
  activeView: ActivityView;
  onViewChange: (view: ActivityView) => void;
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
  onOpenAccountSettings: () => void;
  /** Starts loading an activity's code before it is opened (hover/focus). */
  onPreloadView?: (view: ActivityView) => void;
}

export function ActivityBar({
  hidden = false,
  activeView,
  onViewChange,
  settingsOpen = false,
  onToggleSettings,
  onOpenAccountSettings,
  onPreloadView,
}: ActivityBarProps) {
  return (
    <div className={`${styles.bar} app-chrome app-chrome--side`} hidden={hidden}>
      {ACTIVITY_DEFINITIONS.map((item) => {
        const Icon = item.icon;
        return (
          <Button
            key={item.view}
            shape="icon"
            active={activeView === item.view}
            onClick={() => onViewChange(item.view)}
            onPointerEnter={() => onPreloadView?.(item.view)}
            onFocus={() => onPreloadView?.(item.view)}
            tooltip={item.label}
            tooltipSide="right"
            ariaLabel={item.label}
            className={styles.item}
            size="rail"
            variant="ghost"
          >
            <Icon size={20} />
          </Button>
        );
      })}
      <div className={styles.bottomActions}>
        <McpActivityButton />
        <LiveActivityButton />
        <AccountButton onOpenSettings={onOpenAccountSettings} />
        <IconButton
          tooltip="Settings"
          tooltipSide="right"
          active={settingsOpen}
          onClick={onToggleSettings}
          className={styles.item}
          size="rail"
          variant="ghost"
        >
          <Settings size={20} />
        </IconButton>
      </div>
    </div>
  );
}
