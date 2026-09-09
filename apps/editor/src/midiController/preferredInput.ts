import { findControllerProfile, type MidiInputPort } from "@viritura/midi";

export function preferredControllerInput(
  inputs: readonly MidiInputPort[],
  role = "controls",
): MidiInputPort | undefined {
  return inputs.find((input) => {
    const profile = findControllerProfile(input);
    if (!profile) return false;
    return profile.ports.some(
      (port) =>
        port.role === role && port.names.some((name) => name.toLocaleLowerCase() === input.name.toLocaleLowerCase()),
    );
  });
}
