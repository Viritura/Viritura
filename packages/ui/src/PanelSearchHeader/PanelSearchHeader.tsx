import { ChevronsDownUp, ChevronsUpDown, X } from "lucide-react";
import { FormInput } from "../FormField";
import { IconButton } from "../IconButton/IconButton";
import styles from "./PanelSearchHeader.module.css";

export interface PanelSearchHeaderProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  searchLabel: string;
  anyOpen: boolean;
  onToggleAll: () => void;
  toggleLabel: string;
  toggleDisabled?: boolean;
}

export function PanelSearchHeader({
  value,
  onValueChange,
  placeholder,
  searchLabel,
  anyOpen,
  onToggleAll,
  toggleLabel,
  toggleDisabled = false,
}: PanelSearchHeaderProps) {
  return (
    <div className={styles.root}>
      <div className={styles.inputWrap}>
        <FormInput
          type="text"
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          placeholder={placeholder}
          aria-label={searchLabel}
        />
        {value && (
          <IconButton size="sm" onClick={() => onValueChange("")} tooltip="Clear search">
            <X size={12} />
          </IconButton>
        )}
      </div>
      <IconButton size="md" disabled={toggleDisabled} onClick={onToggleAll} tooltip={toggleLabel}>
        {anyOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
      </IconButton>
    </div>
  );
}
