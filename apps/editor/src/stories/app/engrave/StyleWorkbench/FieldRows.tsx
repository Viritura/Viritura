import { Button, Select } from "@viritura/ui";
import {
  changeField,
  downstreamOverrides,
  fieldChain,
  isModifiedAtScope,
  resolveField,
  scopeLabel,
  type ChainStep,
  type FieldDefinition,
  type Project,
  type Scope,
} from "./styleModel";
import { FieldActions } from "./StyleActions";
import styles from "./StyleWorkbench.module.css";

export interface FieldEditorProps {
  project: Project;
  scope: Scope;
  fields: FieldDefinition[];
  onCommit: (project: Project, message: string) => void;
  /** Opens another layer of the chain for editing. */
  onJump: (scope: Scope) => void;
}

function SourceTrail({
  field,
  steps,
  onJump,
}: {
  field: FieldDefinition;
  steps: ChainStep[];
  onJump: (scope: Scope) => void;
}) {
  if (steps.length < 2) return null;
  const winner = [...steps].reverse().find((step) => step.value !== undefined);
  const current = steps.at(-1);
  return (
    <ol className={styles.trail} aria-label={`${field.label} sources`}>
      {steps.map((step) => {
        const state =
          step === winner ? styles.stepWinner : step.value !== undefined ? styles.stepShadowed : styles.stepUnset;
        const isCurrent = step === current;
        return (
          <li key={step.level}>
            <Button
              size="sm"
              variant="link"
              className={`${styles.step} ${state} ${isCurrent ? styles.stepCurrent : ""}`}
              tooltip={`${step.name}: ${step.value ?? "inherits"}`}
              ariaLabel={`${step.name}: ${step.value ?? "inherits"}`}
              disabled={isCurrent}
              onClick={() => onJump(step.scope)}
            >
              {step.level === "house" ? "House" : step.name}
            </Button>
          </li>
        );
      })}
    </ol>
  );
}

export function FieldRows({ project, scope, fields, onCommit, onJump }: FieldEditorProps) {
  const target = scopeLabel(project, scope);
  return fields.map((field) => {
    const resolved = resolveField(project, scope, field.id);
    const explicit = isModifiedAtScope(project, scope, field.id);
    const below = downstreamOverrides(project, scope, field.id);
    const name = field.label.toLowerCase();
    return (
      <div className={`${styles.field} ${explicit ? styles.fieldSet : ""}`} key={field.id}>
        <div className={styles.fieldHead}>
          <span className={styles.fieldLabel}>{field.label}</span>
          <SourceTrail field={field} steps={fieldChain(project, scope, field.id)} onJump={onJump} />
          <span className={styles.fieldActions}>
            <FieldActions project={project} scope={scope} field={field} onCommit={onCommit} />
          </span>
        </div>
        <Select
          aria-label={field.label}
          value={resolved.value}
          options={field.options}
          onValueChange={(value) =>
            onCommit(changeField(project, scope, field.id, value), `Set ${name} to ${value} in ${target}.`)
          }
        />
        {below.length > 0 && (
          <div className={styles.downstream}>
            <span>Custom in</span>
            {below.map((entry) => (
              <Button
                key={`${entry.scope.kind}:${entry.name}`}
                size="sm"
                variant="link"
                className={styles.downstreamChip}
                tooltip={`${entry.name}: ${entry.value}`}
                ariaLabel={`${entry.name} custom setting`}
                onClick={() => onJump(entry.scope)}
              >
                {entry.name}
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  });
}
