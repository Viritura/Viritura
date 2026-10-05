import { useState } from "react";
import { useStore } from "zustand";
import { toast } from "sonner";
import type { Part, Score, Transposition } from "@viritura/core";
import {
  Checkbox,
  Button,
  Collapsible,
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogPrimaryButton,
  DialogHeader,
  FormField,
  FormInput,
} from "@viritura/ui";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";
import { closeDialog, useDialogStore } from "../store/dialogStore";
import { initialBarChangeFields, changeInstruction, changeReminder, numberFieldValue } from "./dialogFields";
import { ChangeLabelFields } from "./ChangeLabelFields";
import { InstrumentCatalogPicker } from "../components/parts/InstrumentCatalogPicker";
import {
  TranspositionPitchFields,
  TranspositionPreview,
  soundingPitchLabel,
} from "../components/parts/transpositionPitch";
import {
  buildPartTransposition,
  catalogPickerName,
  getCatalogInstrument,
  type CatalogInstrument,
} from "../score/InstrumentCatalog";
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
  onClose: () => void;
  store: DocumentStore;
  selection: SelectionState;
  updateScore: (score: Score) => void;
}

export function BarInstrumentChangeDialogs(props: Pick<HostProps, "store" | "selection" | "updateScore">) {
  const instrumentOpen = useDialogStore((state) => state.open.barInstrumentChange);
  return (
    <BarInstrumentChangeDialogHost
      {...props}
      open={instrumentOpen}
      onClose={() => closeDialog("barInstrumentChange")}
    />
  );
}

export function BarInstrumentChangeDialogHost(props: HostProps) {
  const score = useStore(props.store, (state) => state.score);
  if (!props.open) return null;
  const target = resolveBarInstrumentTarget(score, props.selection);
  const part = target ? score?.parts[target.partIndex] : undefined;
  if (!target || !part) {
    return (
      <Dialog open size="wide" onClose={props.onClose}>
        <DialogHeader title="Change instrument or tuning" onClose={props.onClose} />
        <DialogBody>Select a single bar in one source part to change its instrument or tuning.</DialogBody>
        <DialogActions>
          <DialogCancelButton />
        </DialogActions>
      </Dialog>
    );
  }
  return (
    <BarChangeForm
      key={`${part.id ?? target.partIndex}:${target.measureIndex}`}
      {...props}
      target={target}
      part={part}
      houseStyle={score?.instrumentChangeStyle}
    />
  );
}

interface FormProps extends HostProps {
  target: BarInstrumentTarget;
  part: Part;
  houseStyle?: Score["instrumentChangeStyle"];
}

function BarChangeForm({ onClose, store, updateScore, target, part, houseStyle }: FormProps) {
  const initial = initialBarChangeFields(part, target.measureIndex);
  const { change } = initial;
  const [instrumentId, setInstrumentId] = useState(initial.instrumentId);
  const instrument = getCatalogInstrument(instrumentId);
  const [halfSteps, setHalfSteps] = useState(initial.halfSteps);
  const [staffDistance, setStaffDistance] = useState(initial.staffDistance);
  const [flipAt, setFlipAt] = useState<number | "">(initial.flipAt);
  const [prefersWritten, setPrefersWritten] = useState(initial.prefersWritten);
  const [text, setText] = useState(initial.text);
  const [hidden, setHidden] = useState(initial.hidden);
  const [reminderText, setReminderText] = useState(initial.reminderText);
  const [reminderHidden, setReminderHidden] = useState(initial.reminderHidden);
  const [error, setError] = useState<string>();
  const [instrumentChanged, setInstrumentChanged] = useState(false);
  const [tuningOverride, setTuningOverride] = useState(!!change?.transposition);
  const [tuningOpen, setTuningOpen] = useState(initial.customTuning);
  const instruction = changeInstruction(text, hidden);
  const reminder = changeReminder(reminderText, reminderHidden);
  const validNumbers = [halfSteps, staffDistance, flipAt === "" ? 0 : flipAt].every(Number.isSafeInteger);

  function resetDefaultTuning(instrument: CatalogInstrument): void {
    const tuning = instrument.transposition && buildPartTransposition(instrument.transposition);
    setHalfSteps(tuning?.interval.halfSteps ?? 0);
    setStaffDistance(tuning?.interval.staffDistance ?? 0);
    setFlipAt(tuning?.keyFifthsFlipAt ?? "");
    setPrefersWritten(tuning?.prefersWrittenPitches ?? false);
    setTuningOverride(false);
  }

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
    const switching = instrumentChanged;
    const customizing = !switching || tuningOverride;
    if (customizing && !validNumbers) {
      setError("Enter a whole number for the key signature flip threshold, or leave it blank.");
      return;
    }
    const result = switching ? setBarInstrument(score, target, instrumentId, instruction, reminder) : { score };
    if (result.error) {
      finish(result);
      return;
    }
    if (customizing) {
      const transposition: Transposition = buildTransposition(halfSteps, staffDistance, flipAt, prefersWritten) ?? {
        interval: { halfSteps: 0, staffDistance: 0 },
      };
      finish(setBarTransposition(result.score, target, transposition, instruction, reminder));
    } else finish(result);
  }

  return (
    <Dialog open size="wide" onClose={onClose}>
      <DialogHeader title="Change instrument or tuning" onClose={onClose} />
      <DialogBody>
        <p className={styles.scope}>
          <strong>
            {part.name}, bar {target.measureIndex + 1}
          </strong>
        </p>
        <p>Applies from the start of this bar until the next change. Sounding notes are preserved.</p>
        <Collapsible title="Instrument" defaultOpen>
          <InstrumentCatalogPicker
            autoFocus
            selectedInstrumentId={instrumentId}
            onSelect={(instrument) => {
              setInstrumentId(instrument.id);
              setInstrumentChanged(true);
              resetDefaultTuning(instrument);
              setTuningOpen(false);
              setError(undefined);
            }}
            onBlockedSelect={(_instrument, analysis) => setError(analysis.message)}
            compatibility={(instrument) => {
              const message = instrumentChangeCompatibility(part, instrument);
              return {
                status: message ? "blocked" : "compatible",
                message: message ?? "Use this instrument from this bar onward.",
              };
            }}
          />
        </Collapsible>
        <p>
          {instrument ? catalogPickerName(instrument) : part.name}: written C4 sounds as{" "}
          {soundingPitchLabel(halfSteps, staffDistance)}. Selecting an instrument applies its default tuning and clefs.
        </p>
        <Collapsible title="Customize tuning" open={tuningOpen} onOpenChange={setTuningOpen}>
          <div className={styles.fields}>
            <TranspositionPitchFields
              instrumentId={instrumentId}
              halfSteps={halfSteps}
              staffDistance={staffDistance}
              onChange={(chromatic, diatonic) => {
                setHalfSteps(chromatic);
                setStaffDistance(diatonic);
                setTuningOverride(true);
              }}
            />
            <Button
              onClick={() => {
                const instrument = getCatalogInstrument(instrumentId);
                if (instrument) {
                  resetDefaultTuning(instrument);
                  setInstrumentChanged(true);
                }
              }}
              disabled={!getCatalogInstrument(instrumentId)}
            >
              Use instrument default
            </Button>
            <Collapsible title="Notation options">
              <FormField label="Key signature flip threshold">
                <FormInput
                  type="number"
                  value={flipAt}
                  placeholder="No enharmonic flip"
                  onChange={(event) => {
                    setFlipAt(numberFieldValue(event.target.value));
                    setTuningOverride(true);
                  }}
                />
              </FormField>
              <Checkbox
                label="Display written pitches even in concert-pitch scores"
                checked={prefersWritten}
                onChange={(event) => {
                  setPrefersWritten(event.target.checked);
                  setTuningOverride(true);
                }}
              />
            </Collapsible>
          </div>
        </Collapsible>
        {validNumbers && (
          <TranspositionPreview
            instrumentId={instrumentId}
            halfSteps={halfSteps}
            staffDistance={staffDistance}
            keyFifthsFlipAt={flipAt === "" ? undefined : flipAt}
          />
        )}
        <ChangeLabelFields
          text={text}
          hidden={hidden}
          reminderText={reminderText}
          reminderHidden={reminderHidden}
          houseStyle={houseStyle}
          setText={setText}
          setHidden={setHidden}
          setReminderText={setReminderText}
          setReminderHidden={setReminderHidden}
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
          disabled={!validNumbers || !!part.kit || (instrumentChanged && !instrumentId)}
        >
          Apply change
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
