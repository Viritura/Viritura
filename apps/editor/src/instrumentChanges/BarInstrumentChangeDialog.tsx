import { useState } from "react";
import { useStore } from "zustand";
import { toast } from "sonner";
import type { Part, Score, Transposition } from "@viritura/core";
import {
  Checkbox,
  Collapsible,
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogPrimaryButton,
  DialogTitle,
  FormField,
  FormInput,
} from "@viritura/ui";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";
import { closeDialog, useDialogStore } from "../store/dialogStore";
import { initialBarChangeFields, changeInstruction, changeReminder, numberFieldValue } from "./dialogFields";
import { ChangeLabelFields } from "./ChangeLabelFields";
import { InstrumentCatalogPicker } from "../components/parts/InstrumentCatalogPicker";
import { TranspositionPitchFields } from "../components/parts/transpositionPitch";
import { buildTransposition } from "../components/parts/roster/transposition";
import {
  instrumentChangeCompatibility,
  removeBarInstrumentChange,
  resolveBarInstrumentTarget,
  setBarInstrument,
  setBarTransposition,
  type BarChangeResult,
  type BarInstrumentTarget,
} from "./barChanges";
import styles from "./BarInstrumentChangeDialog.module.css";

interface HostProps {
  open: boolean;
  mode: "instrument" | "transposition";
  onClose: () => void;
  store: DocumentStore;
  selection: SelectionState;
  updateScore: (score: Score) => void;
}

export function BarInstrumentChangeDialogs(props: Pick<HostProps, "store" | "selection" | "updateScore">) {
  const instrumentOpen = useDialogStore((state) => state.open.barInstrumentChange);
  const transpositionOpen = useDialogStore((state) => state.open.barTranspositionChange);
  return (
    <>
      <BarInstrumentChangeDialogHost
        {...props}
        open={instrumentOpen}
        mode="instrument"
        onClose={() => closeDialog("barInstrumentChange")}
      />
      <BarInstrumentChangeDialogHost
        {...props}
        open={transpositionOpen}
        mode="transposition"
        onClose={() => closeDialog("barTranspositionChange")}
      />
    </>
  );
}

export function BarInstrumentChangeDialogHost(props: HostProps) {
  const score = useStore(props.store, (state) => state.score);
  if (!props.open) return null;
  const target = resolveBarInstrumentTarget(score, props.selection);
  const part = target ? score?.parts[target.partIndex] : undefined;
  if (!target || !part) {
    return (
      <Dialog open onClose={props.onClose}>
        <DialogTitle>Change {props.mode}</DialogTitle>
        <DialogBody>Select a single bar in one source part to change its {props.mode}.</DialogBody>
        <DialogActions>
          <DialogCancelButton />
        </DialogActions>
      </Dialog>
    );
  }
  return (
    <BarChangeForm
      key={`${props.mode}:${part.id ?? target.partIndex}:${target.measureIndex}`}
      {...props}
      target={target}
      part={part}
    />
  );
}

interface FormProps extends HostProps {
  target: BarInstrumentTarget;
  part: Part;
}

function BarChangeForm({ mode, onClose, store, updateScore, target, part }: FormProps) {
  const initial = initialBarChangeFields(part, target.measureIndex);
  const { change } = initial;
  const [instrumentId, setInstrumentId] = useState(initial.instrumentId);
  const [halfSteps, setHalfSteps] = useState(initial.halfSteps);
  const [staffDistance, setStaffDistance] = useState(initial.staffDistance);
  const [flipAt, setFlipAt] = useState<number | "">(initial.flipAt);
  const [prefersWritten, setPrefersWritten] = useState(initial.prefersWritten);
  const [text, setText] = useState(initial.text);
  const [hidden, setHidden] = useState(initial.hidden);
  const [reminderText, setReminderText] = useState(initial.reminderText);
  const [reminderEnabled, setReminderEnabled] = useState(initial.reminderEnabled);
  const [error, setError] = useState<string>();
  const instruction = changeInstruction(text, hidden);
  const reminder = changeReminder(reminderText, reminderEnabled, change?.reminder);
  const validNumbers = [halfSteps, staffDistance, flipAt === "" ? 0 : flipAt].every(Number.isSafeInteger);

  function finish(result: BarChangeResult): void {
    if (result.error) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    updateScore(result.score);
    onClose();
  }

  function apply(): void {
    const document = store.getState();
    const score = document.workingScore ?? document.score;
    if (!score || score.parts[target.partIndex]?.id !== part.id) {
      setError("The selected part no longer exists.");
      return;
    }
    if (mode === "instrument") {
      finish(setBarInstrument(score, target, instrumentId, instruction, reminder));
    } else {
      if (!validNumbers) {
        setError("Enter a whole number for the key signature flip threshold, or leave it blank.");
        return;
      }
      const transposition: Transposition = buildTransposition(halfSteps, staffDistance, flipAt, prefersWritten) ?? {
        interval: { halfSteps: 0, staffDistance: 0 },
      };
      finish(setBarTransposition(score, target, transposition, instruction, reminder));
    }
  }

  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>{mode === "instrument" ? "Change instrument" : "Change transposition"}</DialogTitle>
      <DialogBody>
        <p className={styles.scope}>
          <strong>
            {part.name}, bar {target.measureIndex + 1}
          </strong>
        </p>
        <p>Applies from the start of this bar until the next change. Sounding notes are preserved.</p>
        {mode === "instrument" ? (
          <>
            <InstrumentCatalogPicker
              autoFocus
              selectedInstrumentId={instrumentId}
              onSelect={(instrument) => setInstrumentId(instrument.id)}
              onBlockedSelect={(_instrument, analysis) => setError(analysis.message)}
              compatibility={(instrument) => {
                const message = instrumentChangeCompatibility(part, instrument);
                return {
                  status: message ? "blocked" : "compatible",
                  message: message ?? "Use this instrument from this bar onward.",
                };
              }}
            />
            <p>
              The instrument&apos;s default transposition and clefs apply. Edit transposition separately to override it.
            </p>
          </>
        ) : (
          <div className={styles.fields}>
            <TranspositionPitchFields
              instrumentId={initial.instrumentId}
              halfSteps={halfSteps}
              staffDistance={staffDistance}
              onChange={(chromatic, diatonic) => {
                setHalfSteps(chromatic);
                setStaffDistance(diatonic);
              }}
            />
            <Collapsible title="Notation options">
              <FormField label="Key signature flip threshold">
                <FormInput
                  type="number"
                  value={flipAt}
                  placeholder="No enharmonic flip"
                  onChange={(event) => setFlipAt(numberFieldValue(event.target.value))}
                />
              </FormField>
              <Checkbox
                label="Display written pitches even in concert-pitch scores"
                checked={prefersWritten}
                onChange={(event) => setPrefersWritten(event.target.checked)}
              />
            </Collapsible>
          </div>
        )}
        <ChangeLabelFields
          text={text}
          hidden={hidden}
          reminderText={reminderText}
          reminderEnabled={reminderEnabled}
          setText={setText}
          setHidden={setHidden}
          setReminderText={setReminderText}
          setReminderEnabled={setReminderEnabled}
        />
        {error && <p role="alert">{error}</p>}
        {change && <p>This replaces the change at this bar&apos;s start, preserving later changes.</p>}
      </DialogBody>
      <DialogActions>
        {change && (
          <DialogPrimaryButton
            onClick={() => {
              const document = store.getState();
              const score = document.workingScore ?? document.score;
              if (score) finish(removeBarInstrumentChange(score, target));
              else setError("The score is no longer open.");
            }}
          >
            Remove change
          </DialogPrimaryButton>
        )}
        <DialogCancelButton />
        <DialogPrimaryButton
          onClick={apply}
          disabled={mode === "instrument" ? !instrumentId : !validNumbers || !!part.kit}
        >
          Apply change
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
