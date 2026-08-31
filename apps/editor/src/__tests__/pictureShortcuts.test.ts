import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardRegistry } from "../keyboard/KeyboardRegistry";
import { registerPictureShortcuts } from "../components/modes/picture/usePictureShortcuts";

describe("Picture shortcuts", () => {
  let uninstall: (() => void) | null = null;

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it("handles M only while the Picture registration is active", () => {
    const registry = new KeyboardRegistry();
    registry.setContextCallback(() => "normal");
    registry.setIsInputCallback(() => false);
    uninstall = registry.install();
    const onAddMarker = vi.fn();
    const leavePicture = registerPictureShortcuts(onAddMarker, registry);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true }));
    expect(onAddMarker).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", repeat: true, bubbles: true, cancelable: true }));
    expect(onAddMarker).toHaveBeenCalledTimes(1);

    leavePicture();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true }));
    expect(onAddMarker).toHaveBeenCalledTimes(1);
  });

  it("does not spot while the composer is typing", () => {
    const registry = new KeyboardRegistry();
    registry.setContextCallback(() => "normal");
    registry.setIsInputCallback(() => true);
    uninstall = registry.install();
    const onAddMarker = vi.fn();
    registerPictureShortcuts(onAddMarker, registry);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true }));
    expect(onAddMarker).not.toHaveBeenCalled();
  });
});
