import mpkMiniIvJson from "../../controllers/akai/mpk-mini-iv.json";
import type { MidiInputMessage, MidiInputPort } from "../midiInput";
import { parseControllerProfile } from "./profileParser";
import type { ControllerAction, ControllerProfile } from "./types";

const BUILTIN_PROFILES: readonly ControllerProfile[] = [parseControllerProfile(mpkMiniIvJson)];
const PROFILE_SOURCE_URLS: Readonly<Record<string, string>> = {
  "akai.mpk-mini-iv": "https://github.com/Viritura/Viritura/blob/main/packages/midi/controllers/akai/mpk-mini-iv.json",
};

function includesCaseInsensitive(value: string, candidates: readonly string[]): boolean {
  const normalized = value.toLocaleLowerCase();
  return candidates.some((candidate) => normalized.includes(candidate.toLocaleLowerCase()));
}

export function listControllerProfiles(): readonly ControllerProfile[] {
  return BUILTIN_PROFILES;
}

export function controllerProfileSourceUrl(profileId: string): string | undefined {
  return PROFILE_SOURCE_URLS[profileId];
}

export function findControllerProfile(port: MidiInputPort): ControllerProfile | undefined {
  return BUILTIN_PROFILES.find(
    (profile) =>
      includesCaseInsensitive(port.name, profile.match.nameIncludes) &&
      (profile.match.manufacturerIncludes.length === 0 ||
        port.manufacturer.length === 0 ||
        includesCaseInsensitive(port.manufacturer, profile.match.manufacturerIncludes)),
  );
}

export function controllerPortRole(profile: ControllerProfile, portName: string): string | undefined {
  const normalized = portName.toLocaleLowerCase();
  return profile.ports.find((port) => port.names.some((name) => name.toLocaleLowerCase() === normalized))?.role;
}

export function resolveControllerAction(
  profile: ControllerProfile,
  portName: string,
  message: MidiInputMessage,
): ControllerAction | undefined {
  const portRole = controllerPortRole(profile, portName);
  const channel = message.channel;
  if (!portRole || channel === null) return undefined;

  const binding = profile.bindings.find(
    (candidate) =>
      candidate.portRole === portRole &&
      candidate.message === message.kind &&
      candidate.channel === channel + 1 &&
      candidate.number === message.data1 &&
      (candidate.value === undefined || candidate.value === message.data2),
  );
  return binding?.action;
}

export function isControllerPreviewMessage(
  profile: ControllerProfile,
  portName: string,
  message: MidiInputMessage,
): boolean {
  const preview = profile.notePreview;
  return (
    preview !== undefined &&
    (message.kind === "note-on" || message.kind === "note-off") &&
    message.channel !== null &&
    controllerPortRole(profile, portName) === preview.portRole &&
    preview.channels.includes(message.channel + 1)
  );
}
