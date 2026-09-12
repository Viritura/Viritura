import {
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogHeader,
  DialogPrimaryButton,
} from "@viritura/ui";
import type { CatalogInstrument } from "../../score/InstrumentCatalog";
import type { ConductorScore } from "../../score/ScoreMutations";
import { InstrumentCatalogPicker, type InstrumentCompatibility } from "./InstrumentCatalogPicker";
import styles from "./InstrumentPickerDialog.module.css";

interface InstrumentPickerDialogBaseProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSelect: (instrument: CatalogInstrument) => void;
}

interface AddInstrumentDialogProps extends InstrumentPickerDialogBaseProps {
  readonly mode: "add";
  readonly pendingInstrumentId: string | null;
  readonly pendingInstrumentName: string | null;
  readonly conductorScores: readonly ConductorScore[];
  readonly targetLayoutIds: ReadonlySet<string>;
  readonly onToggleTarget: (layoutId: string) => void;
  readonly onConfirm: () => void;
}

interface ChangeInstrumentDialogProps extends InstrumentPickerDialogBaseProps {
  readonly mode: "change";
  readonly compatibility: (instrument: CatalogInstrument) => InstrumentCompatibility;
  readonly onBlockedSelect: (instrument: CatalogInstrument, analysis: InstrumentCompatibility) => void;
}

export type InstrumentPickerDialogProps = AddInstrumentDialogProps | ChangeInstrumentDialogProps;

export function InstrumentPickerDialog(props: InstrumentPickerDialogProps) {
  const title = props.mode === "change" ? "Change instrument" : "Add instrument";

  return (
    <Dialog open={props.open} onClose={props.onClose} size="wide">
      <DialogHeader title={title} onClose={props.onClose} />
      <DialogBody className={styles.body}>
        <div className={styles.catalog}>
          <InstrumentCatalogPicker
            onSelect={props.onSelect}
            onBlockedSelect={props.mode === "change" ? props.onBlockedSelect : undefined}
            compatibility={props.mode === "change" ? props.compatibility : undefined}
            selectedInstrumentId={props.mode === "add" ? (props.pendingInstrumentId ?? undefined) : undefined}
            searchPlaceholder={props.mode === "change" ? "Search replacement instruments…" : "Search instruments…"}
            autoFocus
            maxHeight={420}
          />
        </div>
        {props.mode === "add" && props.pendingInstrumentName && (
          <ScoreTargets
            instrumentName={props.pendingInstrumentName}
            conductorScores={props.conductorScores}
            targetLayoutIds={props.targetLayoutIds}
            onToggleTarget={props.onToggleTarget}
          />
        )}
      </DialogBody>
      <DialogActions>
        <DialogCancelButton>Cancel</DialogCancelButton>
        {props.mode === "add" && (
          <DialogPrimaryButton onClick={props.onConfirm} disabled={!props.pendingInstrumentId}>
            Add instrument
          </DialogPrimaryButton>
        )}
      </DialogActions>
    </Dialog>
  );
}

function ScoreTargets({
  instrumentName,
  conductorScores,
  targetLayoutIds,
  onToggleTarget,
}: {
  readonly instrumentName: string;
  readonly conductorScores: readonly ConductorScore[];
  readonly targetLayoutIds: ReadonlySet<string>;
  readonly onToggleTarget: (layoutId: string) => void;
}) {
  return (
    <div className={styles.targets}>
      {conductorScores.length > 0 ? (
        <>
          <p className={styles.targetTitle}>
            Include <strong>{instrumentName}</strong> in these scores:
          </p>
          <div className={styles.targetList}>
            {conductorScores.map((score) => (
              <Checkbox
                key={score.layoutId}
                label={score.name}
                checked={targetLayoutIds.has(score.layoutId)}
                onChange={() => onToggleTarget(score.layoutId)}
              />
            ))}
          </div>
          <p className={styles.hint}>The instrument and its instrumental part are always created.</p>
        </>
      ) : (
        <p className={styles.targetTitle}>
          <strong>{instrumentName}</strong> will be created with its instrumental part.
        </p>
      )}
    </div>
  );
}
