import { useCallback, useState } from "react";
import { AuthApiError, requestVirituraTwoFactorRecovery } from "./api";

type TwoFactorRecoveryRequestStatus = "idle" | "sending" | "sent" | "error";

export interface TwoFactorRecoveryRequest {
  readonly status: TwoFactorRecoveryRequestStatus;
  readonly error: string | null;
  readonly request: () => Promise<void>;
  readonly reset: () => void;
}

/**
 * Drives the "lost your authenticator and recovery codes" affordance in <SignInDialog>. The
 * server endpoint is enumeration-safe (always 204) so a successful POST just flips us to
 * "sent" optimistically. Network failures are the only path to "error".
 */
export function useTwoFactorRecoveryRequest(): TwoFactorRecoveryRequest {
  const [status, setStatus] = useState<TwoFactorRecoveryRequestStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async () => {
    setStatus((prev) => {
      if (prev === "sending" || prev === "sent") return prev;
      return "sending";
    });
    setError(null);
    try {
      await requestVirituraTwoFactorRecovery();
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof AuthApiError ? err.message : "Couldn't send the recovery email right now.");
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  return { status, error, request, reset };
}
