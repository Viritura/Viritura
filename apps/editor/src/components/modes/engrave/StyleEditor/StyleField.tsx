import type { ReactNode } from "react";
import { Button, CascadingMenu, type CascadingMenuItem } from "@viritura/ui";
import styles from "./StyleEditor.module.css";

export interface TrailStep {
  name: string;
  /** This layer stores its own value for the field. */
  set: boolean;
  current: boolean;
  detail: string;
  onJump?: () => void;
}

export interface DownstreamLink {
  key: string;
  name: string;
  detail: string;
  onSelect: () => void;
}

interface StyleFieldProps {
  label: string;
  labelId?: string;
  explicit: boolean;
  trail: readonly TrailStep[];
  actions: readonly CascadingMenuItem[];
  downstream: readonly DownstreamLink[];
  children: ReactNode;
}

function SourceTrail({ label, steps }: { label: string; steps: readonly TrailStep[] }) {
  if (steps.length < 2) return null;
  const winner = [...steps].reverse().find((step) => step.set) ?? steps[0];
  return (
    <ol className={styles.trail} aria-label={`${label} sources`}>
      {steps.map((step) => {
        const state = step === winner ? styles.stepWinner : step.set ? styles.stepShadowed : styles.stepUnset;
        return (
          <li key={step.name}>
            <Button
              size="sm"
              variant="link"
              className={`${styles.step} ${state} ${step.current ? styles.stepCurrent : ""}`}
              tooltip={step.detail}
              ariaLabel={step.detail}
              disabled={step.current || !step.onJump}
              onClick={step.onJump}
            >
              {step.name}
            </Button>
          </li>
        );
      })}
    </ol>
  );
}

/** One inheritable setting: an accent when set at this layer, where its value comes from, and reset actions. */
export function StyleField({ label, labelId, explicit, trail, actions, downstream, children }: StyleFieldProps) {
  return (
    <div className={`${styles.field} ${explicit ? styles.fieldSet : ""}`} data-custom={explicit || undefined}>
      <div className={styles.fieldHead}>
        <span className={styles.fieldLabel} id={labelId}>
          {label}
        </span>
        <SourceTrail label={label} steps={trail} />
        {actions.length > 0 && (
          <span className={styles.fieldActions}>
            <CascadingMenu
              ariaLabel={`${label} actions`}
              label="Actions"
              tooltip={`Actions for ${label}`}
              items={[...actions]}
              triggerSize="xs"
              triggerFullWidth={false}
            />
          </span>
        )}
      </div>
      {children}
      {downstream.length > 0 && (
        <div className={styles.downstream}>
          <span>Custom in</span>
          {downstream.map((entry) => (
            <Button
              key={entry.key}
              size="sm"
              variant="link"
              className={styles.downstreamChip}
              tooltip={entry.detail}
              ariaLabel={`${entry.name} custom setting`}
              onClick={entry.onSelect}
            >
              {entry.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
