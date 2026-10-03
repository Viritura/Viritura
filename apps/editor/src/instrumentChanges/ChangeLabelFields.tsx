import { Checkbox, FormField, FormInput } from "@viritura/ui";
import styles from "./BarInstrumentChangeDialog.module.css";

interface Props {
  text: string;
  hidden: boolean;
  reminderText: string;
  reminderEnabled: boolean;
  setText: (value: string) => void;
  setHidden: (value: boolean) => void;
  setReminderText: (value: string) => void;
  setReminderEnabled: (value: boolean) => void;
}

export function ChangeLabelFields(props: Props) {
  return (
    <div className={styles.fields}>
      <Checkbox
        label="Show label at change"
        checked={!props.hidden}
        onChange={(event) => props.setHidden(!event.target.checked)}
      />
      <FormField label="Change label text">
        <FormInput
          value={props.text}
          disabled={props.hidden}
          placeholder="Automatic instrument or transposition label"
          onChange={(event) => props.setText(event.target.value)}
        />
      </FormField>
      <Checkbox
        label="Show advance reminder"
        checked={props.reminderEnabled}
        onChange={(event) => props.setReminderEnabled(event.target.checked)}
      />
      <p>The reminder appears after the last sounding note before the change, when there is time to change.</p>
      <FormField label="Advance reminder text">
        <FormInput
          value={props.reminderText}
          disabled={!props.reminderEnabled}
          placeholder="Automatic instrument or transposition label"
          onChange={(event) => props.setReminderText(event.target.value)}
        />
      </FormField>
    </div>
  );
}
