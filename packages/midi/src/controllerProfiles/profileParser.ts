import { DURATION_BEATS, type NoteValueBase } from "@viritura/core";
import type { ControllerAction, ControllerBinding, ControllerPortProfile, ControllerProfile } from "./types";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function strings(value: unknown, label: string, allowEmpty = false): readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => string(item, `${label}[${index}]`));
}

function action(value: unknown, label: string): ControllerAction {
  const input = record(value, label);
  const type = string(input.type, `${label}.type`);
  if (type === "transport.play-stop" || type === "history.undo" || type === "note-input.toggle") return { type };
  if (type === "note-input.set-duration") {
    const duration = string(input.duration, `${label}.duration`);
    if (!isNoteValueBase(duration)) throw new Error(`${label}.duration is not a supported note duration`);
    return { type, duration };
  }
  if (type === "note-input.move-cursor") {
    const direction = string(input.direction, `${label}.direction`);
    if (direction !== "left" && direction !== "right" && direction !== "up" && direction !== "down") {
      throw new Error(`${label}.direction is not supported`);
    }
    return { type, direction };
  }

  function isNoteValueBase(value: string): value is NoteValueBase {
    return Object.hasOwn(DURATION_BEATS, value);
  }
  throw new Error(`${label}.type is not supported`);
}

function port(value: unknown, index: number): ControllerPortProfile {
  const input = record(value, `ports[${index}]`);
  return {
    role: string(input.role, `ports[${index}].role`),
    names: strings(input.names, `ports[${index}].names`),
  };
}

function binding(value: unknown, index: number): ControllerBinding {
  const label = `bindings[${index}]`;
  const input = record(value, label);
  const message = string(input.message, `${label}.message`);
  if (message !== "control-change" && message !== "note-on") {
    throw new Error(`${label}.message is not supported`);
  }
  return {
    portRole: string(input.portRole, `${label}.portRole`),
    message,
    channel: integer(input.channel, `${label}.channel`, 1, 16),
    number: integer(input.number, `${label}.number`, 0, 127),
    ...(input.value === undefined ? {} : { value: integer(input.value, `${label}.value`, 0, 127) }),
    action: action(input.action, `${label}.action`),
  };
}

export function parseControllerProfile(value: unknown): ControllerProfile {
  const input = record(value, "profile");
  if (input.schemaVersion !== 1) throw new Error("profile.schemaVersion must be 1");
  const match = record(input.match, "profile.match");
  const tested = record(input.tested, "profile.tested");
  const notePreview = input.notePreview === undefined ? undefined : record(input.notePreview, "profile.notePreview");
  if (!Array.isArray(input.ports) || !Array.isArray(input.bindings)) {
    throw new Error("profile ports and bindings must be arrays");
  }

  const profile: ControllerProfile = {
    schemaVersion: 1,
    id: string(input.id, "profile.id"),
    name: string(input.name, "profile.name"),
    manufacturer: string(input.manufacturer, "profile.manufacturer"),
    match: {
      nameIncludes: strings(match.nameIncludes, "profile.match.nameIncludes"),
      manufacturerIncludes: strings(match.manufacturerIncludes ?? [], "profile.match.manufacturerIncludes", true),
    },
    ports: input.ports.map(port),
    bindings: input.bindings.map(binding),
    ...(notePreview === undefined
      ? {}
      : {
          notePreview: {
            portRole: string(notePreview.portRole, "profile.notePreview.portRole"),
            ...(notePreview.program === undefined
              ? {}
              : { program: integer(notePreview.program, "profile.notePreview.program", 0, 127) }),
            channels: numericChannels(notePreview.channels),
          },
        }),
    tested: {
      operatingSystems: strings(tested.operatingSystems, "profile.tested.operatingSystems"),
      ...(tested.firmware === undefined ? {} : { firmware: string(tested.firmware, "profile.tested.firmware") }),
      notes: string(tested.notes, "profile.tested.notes"),
    },
  };

  const roles = new Set(profile.ports.map((candidate) => candidate.role));
  for (const candidate of profile.bindings) {
    if (!roles.has(candidate.portRole)) throw new Error(`Binding references unknown port role: ${candidate.portRole}`);
  }
  if (profile.notePreview && !roles.has(profile.notePreview.portRole)) {
    throw new Error(`Note preview references unknown port role: ${profile.notePreview.portRole}`);
  }
  return profile;
}

function numericChannels(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("profile.notePreview.channels must be a non-empty array");
  }
  return value.map((channel, index) => integer(channel, `profile.notePreview.channels[${index}]`, 1, 16));
}
