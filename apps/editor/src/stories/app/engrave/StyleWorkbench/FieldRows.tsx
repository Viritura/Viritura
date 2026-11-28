import { ArrowUpToLine, RotateCcw } from "lucide-react";
import { Button, IconButton, Select, Tooltip } from "@viritura/ui";
import {
  builtInValue,
  changeField,
  downstreamOverrides,
  fieldChain,
  findProfile,
  inheritedValue,
  layer,
  parentScope,
  promoteField,
  resetDownstream,
  resolveField,
  scopeLabel,
  type ChainStep,
  type FieldDefinition,
  type Project,
  type Scope,
} from "./styleModel";
import styles from "./StyleWorkbench.module.css";

export interface FieldEditorProps {
  project: Project;
  scope: Scope;
  fields: FieldDefinition[];
  onCommit: (project: Project, message: string) => void;
  /** Opens another layer of the chain for editing. */
  onJump: (scope: Scope) => void;
}

function parentName(project: Project, scope: Scope): string {
  return scope.kind === "profile" ? findProfile(project, scope.id).name : "House";
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
  const winner = [...steps].reverse().find((step) => step.value !== undefined);
  const current = steps.at(-1);
  return (
    <ol className={styles.trail} aria-label={`${field.label} sources`}>
      <li>
        <Tooltip content={`Default: ${builtInValue(field.id)}`}>
          <span className={winner ? styles.stepShadowed : styles.stepWinner} tabIndex={0}>
            Default
          </span>
        </Tooltip>
      </li>
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
  const settings = layer(project, scope);
  const target = scopeLabel(project, scope);
  return fields.map((field) => {
    const resolved = resolveField(project, scope, field.id);
    const explicit = settings[field.id] !== undefined;
    const inherited = inheritedValue(project, scope, field.id);
    const parent = explicit ? parentScope(project, scope, field.id) : undefined;
    const below = downstreamOverrides(project, scope, field.id);
    const name = field.label.toLowerCase();
    return (
      <div className={`${styles.field} ${explicit ? styles.fieldSet : ""}`} key={field.id}>
        <div className={styles.fieldHead}>
          <span className={styles.fieldLabel}>{field.label}</span>
          <SourceTrail field={field} steps={fieldChain(project, scope, field.id)} onJump={onJump} />
          <span className={styles.fieldActions}>
            {parent && (
              <IconButton
                size="xs"
                variant="ghost"
                tooltip={`Move to ${parentName(project, parent)}`}
                aria-label={`Move ${name} to ${parentName(project, parent)}`}
                onClick={() =>
                  onCommit(
                    promoteField(project, scope, field.id),
                    `${field.label} ${resolved.value} moved to ${parentName(project, parent)}.`,
                  )
                }
              >
                <ArrowUpToLine size={12} />
              </IconButton>
            )}
            {explicit && (
              <IconButton
                size="xs"
                variant="ghost"
                tooltip={`Reset to ${inherited.value} (${inherited.source})`}
                aria-label={`Reset ${name}`}
                onClick={() =>
                  onCommit(
                    changeField(project, scope, field.id),
                    `${field.label} in ${target} reset to ${inherited.value}.`,
                  )
                }
              >
                <RotateCcw size={12} />
              </IconButton>
            )}
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
            <span>Overridden in</span>
            {below.map((entry) => (
              <Button
                key={`${entry.scope.kind}:${entry.name}`}
                size="sm"
                variant="link"
                className={styles.downstreamChip}
                tooltip={`${entry.name}: ${entry.value}`}
                ariaLabel={entry.name}
                onClick={() => onJump(entry.scope)}
              >
                {entry.name}
              </Button>
            ))}
            <Button
              size="sm"
              variant="link"
              ariaLabel={`Clear ${name} overrides`}
              tooltip={`Make ${below.length === 1 ? "it" : "them"} inherit ${resolved.value}`}
              onClick={() =>
                onCommit(
                  resetDownstream(project, scope, field.id),
                  `Cleared ${below.length} ${name} ${below.length === 1 ? "override" : "overrides"}.`,
                )
              }
            >
              Clear
            </Button>
          </div>
        )}
      </div>
    );
  });
}
