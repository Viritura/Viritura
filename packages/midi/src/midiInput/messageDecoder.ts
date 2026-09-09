import type { MidiInputMessage, MidiInputMessageKind } from "./types";

const CHANNEL_MESSAGE_MASK = 0xf0;
const CHANNEL_MASK = 0x0f;

function messageKind(status: number, data2: number | undefined): MidiInputMessageKind {
  if (status >= 0xf0) return "system";

  switch (status & CHANNEL_MESSAGE_MASK) {
    case 0x80:
      return "note-off";
    case 0x90:
      return data2 === 0 ? "note-off" : "note-on";
    case 0xa0:
      return "polyphonic-key-pressure";
    case 0xb0:
      return "control-change";
    case 0xc0:
      return "program-change";
    case 0xd0:
      return "channel-pressure";
    case 0xe0:
      return "pitch-bend";
    default:
      return "unknown";
  }
}

export function decodeMidiInputMessage(
  inputId: string,
  receivedTime: number,
  source: ArrayLike<number>,
): MidiInputMessage {
  const data = Array.from(source);
  const status = data[0];
  const channel = status === undefined || status >= 0xf0 ? null : status & CHANNEL_MASK;

  return {
    inputId,
    receivedTime,
    data,
    kind: status === undefined ? "unknown" : messageKind(status, data[2]),
    channel,
    data1: data[1] ?? null,
    data2: data[2] ?? null,
  };
}
