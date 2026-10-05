import type { InstrumentDefinition, Part } from "@viritura/core";

function initialDefinition(part: Part, fallback?: InstrumentDefinition): InstrumentDefinition | undefined {
  const instrumentId = part._x?.viritura?.instrumentId ?? fallback?.instrumentId;
  if (!instrumentId) return undefined;
  const midiProgram = part._x?.viritura?.midiProgram ?? fallback?.midiProgram;
  return {
    instrumentId,
    name: part.name,
    ...(part.shortName ? { shortName: part.shortName } : {}),
    ...(part.transposition ? { transposition: structuredClone(part.transposition) } : {}),
    ...(midiProgram !== undefined ? { midiProgram } : {}),
  };
}

export function nextInstrumentKey(
  instruments: Readonly<Record<string, InstrumentDefinition>>,
  preferred: string,
): string {
  let key = preferred;
  for (let suffix = 2; Object.hasOwn(instruments, key); suffix++) key = `${preferred}-${suffix}`;
  return key;
}

/** Keep later instrument definitions intact when Setup edits the starting identity. */
export function synchronizeInitialInstrument(previous: Part, replacement: Part): Part {
  const ext = previous._x?.viritura;
  if (!ext?.instruments || !ext.initialInstrument) return replacement;
  if (
    previous.name === replacement.name &&
    previous.shortName === replacement.shortName &&
    JSON.stringify(previous.transposition) === JSON.stringify(replacement.transposition) &&
    previous._x?.viritura?.instrumentId === replacement._x?.viritura?.instrumentId &&
    previous._x?.viritura?.midiProgram === replacement._x?.viritura?.midiProgram
  )
    return replacement;
  const previousDefinition = ext.instruments[ext.initialInstrument];
  const definition = initialDefinition(replacement, previousDefinition);
  if (!definition) return replacement;
  if (JSON.stringify(definition) === JSON.stringify(previousDefinition)) {
    return {
      ...replacement,
      _x: {
        ...previous._x,
        ...replacement._x,
        viritura: {
          ...ext,
          ...replacement._x?.viritura,
          instruments: ext.instruments,
          initialInstrument: ext.initialInstrument,
        },
      },
    };
  }
  const referencedLater = previous.measures.some((measure) =>
    measure.instrumentChanges?.some((change) => change.instrument === ext.initialInstrument),
  );
  const key = referencedLater ? nextInstrumentKey(ext.instruments, "initial") : ext.initialInstrument;
  return {
    ...replacement,
    _x: {
      ...previous._x,
      ...replacement._x,
      viritura: {
        ...ext,
        ...replacement._x?.viritura,
        instruments: { ...ext.instruments, [key]: definition },
        initialInstrument: key,
      },
    },
  };
}
