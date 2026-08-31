import { ButtonGroup } from "@viritura/ui";
import { useAudioRenderModeStore, type AudioRenderMode } from "./audioRenderModeStore";

const MODE_OPTIONS: Array<{ value: AudioRenderMode; label: string }> = [
  { value: "web", label: "Web" },
  { value: "native", label: "Native (VST)" },
];

/**
 * Desktop-only picker for the audio render path. Web plays everything in the
 * browser; Native routes every part through the native mixer so VST-configured
 * parts and the built-in SoundFont share one clock and one reverb bus.
 */
export function AudioRenderModeSettings() {
  const mode = useAudioRenderModeStore((s) => s.mode);
  const setMode = useAudioRenderModeStore((s) => s.setMode);

  return (
    <div>
      <ButtonGroup options={MODE_OPTIONS} value={mode} onChange={(value) => setMode(value)} />
      <p style={AUDIO_MODE_HINT_STYLE}>
        {mode === "native"
          ? "All parts play through the native mixer — VST instruments through their plugin, everything else through the built-in SoundFont, sharing one clock and the VST reverb."
          : "Everything plays in the browser. Choose Native to route playback through configured VST instruments."}
      </p>
    </div>
  );
}

const AUDIO_MODE_HINT_STYLE = {
  marginTop: 8,
  fontSize: 12,
  opacity: 0.7,
  lineHeight: 1.4,
} as const;
