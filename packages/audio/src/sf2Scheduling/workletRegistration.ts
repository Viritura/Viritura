const registrations = new WeakMap<BaseAudioContext, Promise<void>>();

/** Share in-flight registration too: concurrent pool creation must not register
 * the same processor name twice in one AudioContext. Failed loads can retry. */
export function registerSchedulingWorklet(context: BaseAudioContext, workletUrl: string): Promise<void> {
  const existing = registrations.get(context);
  if (existing) return existing;
  const registration = loadWorklet(context, workletUrl).catch((error: unknown) => {
    registrations.delete(context);
    throw error;
  });
  registrations.set(context, registration);
  return registration;
}

async function loadWorklet(context: BaseAudioContext, workletUrl: string): Promise<void> {
  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (error) {
    throw new Error(
      `Failed to load ${workletUrl}: ${error instanceof Error ? error.message : String(error)}. ` +
        "Check that the staged worklet is deployed, reachable, and permitted by the Content Security Policy.",
      { cause: error },
    );
  }
}

export function cancelScheduledNotes(port: MessagePort, channels: readonly number[], fromAudioTime: number): void {
  if (Number.isNaN(fromAudioTime)) throw new RangeError("The SF2 cancellation cutoff must not be NaN");
  port.postMessage({ type: "viritura:cancelScheduledNotes", channels: [...channels], fromAudioTime });
}
