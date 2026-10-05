import { FormField, FormInput, Select } from "@viritura/ui";
import type { InstrumentChangeStyle } from "@viritura/core";
import styles from "./BarInstrumentChangeDialog.module.css";

interface Props {
  text: string;
  hidden: boolean | undefined;
  reminderText: string;
  reminderHidden: boolean | undefined;
  houseStyle?: InstrumentChangeStyle;
  setText: (value: string) => void;
  setHidden: (value: boolean | undefined) => void;
  setReminderText: (value: string) => void;
  setReminderHidden: (value: boolean | undefined) => void;
}

function visibilityValue(hidden: boolean | undefined): string {
  return hidden === undefined ? "inherit" : hidden ? "hide" : "show";
}

function visibilityOptions(shown: boolean) {
  return [
    { value: "inherit", label: `Use house style (${shown ? "shown" : "hidden"})` },
    { value: "show", label: "Show" },
    { value: "hide", label: "Hide" },
  ];
}

export function ChangeLabelFields(props: Props) {
  const showLabel = !(props.hidden ?? !(props.houseStyle?.showChangeLabel ?? true));
  const showReminder = !(props.reminderHidden ?? !(props.houseStyle?.showAdvanceReminder ?? true));
  return (
    <div className={styles.fields}>
      <p>Visibility defaults are set in Engrave → House Style → Instrument Changes. Override only this change below.</p>
      <FormField label="Label at change">
        <Select
          value={visibilityValue(props.hidden)}
          options={visibilityOptions(props.houseStyle?.showChangeLabel ?? true)}
          onValueChange={(value) => props.setHidden(value === "inherit" ? undefined : value === "hide")}
        />
      </FormField>
      <FormField label="Change label text">
        <FormInput
          value={props.text}
          disabled={!showLabel}
          placeholder="Automatic instrument or transposition label"
          onChange={(event) => props.setText(event.target.value)}
        />
      </FormField>
      <FormField label="Advance reminder">
        <Select
          value={visibilityValue(props.reminderHidden)}
          options={visibilityOptions(props.houseStyle?.showAdvanceReminder ?? true)}
          onValueChange={(value) => props.setReminderHidden(value === "inherit" ? undefined : value === "hide")}
        />
      </FormField>
      <p>The reminder appears after the last sounding note before the change, when there is time to change.</p>
      <FormField label="Advance reminder text">
        <FormInput
          value={props.reminderText}
          disabled={!showReminder}
          placeholder="Automatic instrument or transposition label"
          onChange={(event) => props.setReminderText(event.target.value)}
        />
      </FormField>
    </div>
  );
}
