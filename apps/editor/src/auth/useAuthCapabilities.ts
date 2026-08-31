import { useEffect, useState } from "react";
import { getAuthCapabilities, type AuthCapabilities } from "./api";

/** Load public auth availability only while the sign-in surface is open. */
export function useAuthCapabilities(open: boolean): AuthCapabilities | null {
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void getAuthCapabilities()
      .then((value) => {
        if (active) setCapabilities(value);
      })
      .catch(() => {
        // The API remains authoritative. Hide optional providers when their
        // capability cannot be confirmed, while leaving password sign-in usable.
        if (active) setCapabilities(null);
      });
    return () => {
      active = false;
    };
  }, [open]);

  return capabilities;
}
