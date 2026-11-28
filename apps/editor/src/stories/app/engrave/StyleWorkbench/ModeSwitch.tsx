import { Palette } from "lucide-react";
import { Badge, Button, Tabs } from "@viritura/ui";
import { LAYOUT_TABS, type Destination } from "./styleModel";
import styles from "./StyleWorkbench.module.css";

interface ModeProps {
  destination: Destination;
  onDestination: (destination: Destination) => void;
}

export function HouseStyleEntry({
  name,
  modified,
  destination,
  onDestination,
}: ModeProps & { name: string; modified: boolean }) {
  return (
    <span className={styles.houseStyleEntry}>
      <span className={styles.hint}>House style</span>
      <strong>{name}</strong>
      {modified && <Badge variant="warning">Custom</Badge>}
      <Button
        size="sm"
        active={destination === "house"}
        ariaLabel="Edit house style"
        disabled={destination === "house"}
        onClick={() => onDestination("house")}
      >
        <Palette size={14} />
        Edit
      </Button>
    </span>
  );
}

export function PanelModeHeader({ destination, onDestination }: ModeProps) {
  if (destination === "house") {
    return (
      <div className={styles.modeHeader}>
        <strong>Editing house style</strong>
        <Button size="sm" variant="primary" onClick={() => onDestination("layout")}>
          Done
        </Button>
      </div>
    );
  }
  return (
    <Tabs
      tabs={LAYOUT_TABS}
      activeTab={destination}
      onTabChange={(id) => {
        const entry = LAYOUT_TABS.find((item) => item.id === id);
        if (entry) onDestination(entry.id);
      }}
    />
  );
}
