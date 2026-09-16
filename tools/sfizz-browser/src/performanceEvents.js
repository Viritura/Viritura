export const maxScheduleSeconds = 20;
export const maxEventsPerRequest = 256;

export function validateEvents(events) {
  if (!Array.isArray(events) || events.length === 0 || events.length > maxEventsPerRequest) {
    throw new Error(`Playback requires between 1 and ${maxEventsPerRequest} events.`);
  }
  return events.map(validateEvent);
}

export function validateEvent(event) {
  const time = validateNumber(event?.time, "Event time", 0, maxScheduleSeconds);
  if (event?.type === "noteOn" || event?.type === "noteOff") {
    return {
      note: validateInteger(event.note, "MIDI note", 0, 127),
      time,
      type: event.type,
      velocity: validateNumber(event.velocity, "Velocity", 0, 1),
    };
  }
  if (event?.type === "cc") {
    return {
      number: validateInteger(event.number, "CC number", 0, 127),
      time,
      type: "cc",
      value: validateNumber(event.value, "CC value", 0, 1),
    };
  }
  throw new Error(`Unsupported playback event type: ${event?.type}`);
}

export function validateInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function validateNumber(value, label, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}
