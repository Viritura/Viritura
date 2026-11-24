import { Select, type SelectOption } from "@viritura/ui";
import { MP3_BITRATES, WAV_BIT_DEPTHS } from "@viritura/playback";
import styles from "../PublishView.module.css";
import type { AudioExportFormat, AudioQuality, ExportFormat } from "./audioFormats";

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>{label}</div>
      <div className={styles.sectionBody}>{children}</div>
    </div>
  );
}

const FORMAT_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: "pdf", label: "PDF" },
  { value: "musicxml", label: "MusicXML", disabled: true },
  { value: "mnx", label: "MNX", disabled: true },
  { value: "midi", label: "MIDI", disabled: true },
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
];

const MP3_BITRATE_OPTIONS: ReadonlyArray<SelectOption> = MP3_BITRATES.map((value) => ({
  value: String(value),
  label: `${value} kbps`,
}));

const WAV_BIT_DEPTH_OPTIONS: ReadonlyArray<SelectOption> = WAV_BIT_DEPTHS.map((value) => ({
  value: String(value),
  label: `${value}-bit${value === 32 ? " float" : ""}`,
}));

export function AudioQualitySelect({
  format,
  quality,
  onChange,
  disabled,
}: {
  format: AudioExportFormat;
  quality: AudioQuality;
  onChange: (quality: AudioQuality) => void;
  disabled: boolean;
}) {
  if (format === "mp3") {
    return (
      <Select
        aria-label="MP3 bitrate"
        value={String(quality.mp3Bitrate)}
        onValueChange={(next) => {
          const bitrate = MP3_BITRATES.find((value) => String(value) === next);
          if (bitrate) onChange({ ...quality, mp3Bitrate: bitrate });
        }}
        options={MP3_BITRATE_OPTIONS}
        disabled={disabled}
      />
    );
  }
  return (
    <Select
      aria-label="WAV bit depth"
      value={String(quality.wavBitDepth)}
      onValueChange={(next) => {
        const bitDepth = WAV_BIT_DEPTHS.find((value) => String(value) === next);
        if (bitDepth) onChange({ ...quality, wavBitDepth: bitDepth });
      }}
      options={WAV_BIT_DEPTH_OPTIONS}
      disabled={disabled}
    />
  );
}

export function FormatSelect({
  value,
  onChange,
  disabled,
}: {
  value: ExportFormat;
  onChange: (value: ExportFormat) => void;
  disabled: boolean;
}) {
  return (
    <Select
      aria-label="Export format"
      value={value}
      onValueChange={(next) => {
        if (next === "pdf" || next === "mp3" || next === "wav") onChange(next);
      }}
      options={FORMAT_OPTIONS}
      disabled={disabled}
    />
  );
}
