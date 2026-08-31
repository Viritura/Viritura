import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";

/**
 * Canary for the whole StrictMode safety scheme.
 *
 * The dev server no longer wraps the app in StrictMode (it's opt-in via
 * VITE_STRICT=1), so the effect double-invoke that catches incomplete cleanup
 * only runs here, via `reactStrictMode` in vitest.setup.ts. If that config is
 * ever dropped, the provider lifecycle tests would still pass while silently
 * testing nothing — this test fails instead.
 */
describe("test environment", () => {
  it("mounts components under StrictMode", async () => {
    const setups: number[] = [];
    const cleanups: number[] = [];

    function Subject() {
      const instance = useRef(0);
      useEffect(() => {
        const id = ++instance.current;
        setups.push(id);
        return () => void cleanups.push(id);
      }, []);
      return null;
    }

    render(<Subject />);

    await waitFor(() => expect(setups.length).toBe(2));
    expect(cleanups.length).toBe(1);
  });
});
