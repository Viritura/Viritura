import { MidiInputManager, queryMidiPermission } from "@viritura/midi";
import { preferredControllerInput } from "./preferredInput";

export const midiControllerManager = new MidiInputManager();
export const midiPerformanceManager = new MidiInputManager();

function selectPreferredInput(manager: MidiInputManager, role: "controls" | "performance"): void {
  if (manager.selectedInput) return;
  const inputs = manager.getInputs();
  const preferred = preferredControllerInput(inputs, role) ?? (inputs.length === 1 ? inputs[0] : undefined);
  if (preferred) manager.selectInput(preferred.id);
}

midiControllerManager.on("inputschanged", () => selectPreferredInput(midiControllerManager, "controls"));
midiPerformanceManager.on("inputschanged", () => selectPreferredInput(midiPerformanceManager, "performance"));

export async function initializeProfiledMidiInputs(): Promise<boolean> {
  const controlsInitialized = await midiControllerManager.init();
  if (!controlsInitialized) return false;
  selectPreferredInput(midiControllerManager, "controls");

  if (await midiPerformanceManager.init()) {
    selectPreferredInput(midiPerformanceManager, "performance");
  }
  return true;
}

/** Initialize silently only when the browser has already granted this origin MIDI access. */
export async function autoInitializeProfiledMidiInputs(): Promise<boolean> {
  if ((await queryMidiPermission()) !== "granted") return false;
  return initializeProfiledMidiInputs();
}
