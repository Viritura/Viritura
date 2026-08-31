import { useState } from "react";
import { FileText, FileCode2, FileJson, FileMusic, FileAudio } from "lucide-react";
import { Select, type SelectOption } from "@viritura/ui";
import styles from "../PublishView.module.css";

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>{label}</div>
      <div className={styles.sectionBody}>{children}</div>
    </div>
  );
}

const FORMAT_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: "pdf", label: "PDF — Publication-quality print", icon: <FileText size={16} /> },
  { value: "musicxml", label: "MusicXML (coming soon)", icon: <FileCode2 size={16} />, disabled: true },
  { value: "mnx", label: "MNX (coming soon)", icon: <FileJson size={16} />, disabled: true },
  { value: "midi", label: "MIDI (coming soon)", icon: <FileMusic size={16} />, disabled: true },
  { value: "audio", label: "Audio WAV / MP3 (coming soon)", icon: <FileAudio size={16} />, disabled: true },
];

export function FormatSelect() {
  // Only PDF will actually export today, but every option is selectable so
  // the dropdown can be interacted with and styled meaningfully.
  const [value, setValue] = useState("pdf");
  return <Select value={value} onValueChange={setValue} options={FORMAT_OPTIONS} />;
}
