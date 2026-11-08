import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { isDesktopHost } from "../instrumentProfiles";
import { PwaNotifications } from "./PwaNotifications";

const { Workbox, register, callbacks, messageSkipWaiting } = vi.hoisted(() => {
  const callbacks = new Map<string, (event: { isUpdate?: boolean; sw?: object }) => void>();
  const register = vi.fn();
  const messageSkipWaiting = vi.fn();
  const Workbox = vi.fn(function () {
    return {
      register,
      messageSkipWaiting,
      addEventListener: (event: string, callback: (event: { isUpdate?: boolean; sw?: object }) => void) =>
        callbacks.set(event, callback),
    };
  });
  return { Workbox, register, callbacks, messageSkipWaiting };
});
vi.mock("workbox-window", () => ({ Workbox }));
vi.mock("../instrumentProfiles", () => ({ isDesktopHost: vi.fn(() => false) }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  callbacks.clear();
  register.mockResolvedValue({ update: vi.fn() });
  vi.stubEnv("PROD", true);
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

async function registerWorker(): Promise<void> {
  render(<PwaNotifications />);
  await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
}

describe("PWA installation and update notifications", () => {
  it("registers once under StrictMode and only reports readiness after successful installation", async () => {
    await registerWorker();
    expect(Workbox).toHaveBeenCalledExactlyOnceWith("/sw.js", { scope: "/" });
    expect(register).toHaveBeenCalledWith({ immediate: true });
    expect(toast.success).not.toHaveBeenCalled();
    callbacks.get("installed")?.({ isUpdate: false, sw: {} });
    expect(toast.success).toHaveBeenCalledWith("Viritura is ready for offline notation editing.");
  });

  it("prompts to close windows for updates without forcing activation", async () => {
    await registerWorker();
    callbacks.get("waiting")?.({});
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("Save your work and close all"), {
      id: "pwa-update",
      duration: Infinity,
    });
    expect(messageSkipWaiting).not.toHaveBeenCalled();
  });

  it("surfaces offline setup failures without claiming offline readiness", async () => {
    register.mockRejectedValueOnce(new Error("Storage quota exceeded"));
    await registerWorker();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Offline setup failed. Viritura can still be used online."),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("reports precache installation failures after successful registration", async () => {
    await registerWorker();
    callbacks.get("redundant")?.({ sw: { scriptURL: "/sw.js" } });
    expect(toast.error).toHaveBeenCalledWith("Offline setup or update failed. Reconnect and reopen Viritura to retry.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not report a replaced, successfully installed worker as a failure", async () => {
    await registerWorker();
    const sw = { scriptURL: "/sw.js" };
    callbacks.get("installed")?.({ sw, isUpdate: true });
    callbacks.get("redundant")?.({ sw });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("offers installation only in response to a browser install prompt", async () => {
    await registerWorker();
    const prompt = vi.fn(async () => {});
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: "accepted" }) });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const call = vi.mocked(toast.info).mock.calls.at(-1);
    const options = call?.[1];
    expect(options?.action).toMatchObject({ label: "Install Viritura" });
    expect(prompt).not.toHaveBeenCalled();
    if (options?.action && "onClick" in options.action) {
      options.action.onClick({} as never);
    }
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("appinstalled"));
    expect(toast.dismiss).toHaveBeenCalledWith("pwa-install");
  });

  it("does not register offline support in the native desktop host", async () => {
    vi.mocked(isDesktopHost).mockReturnValueOnce(true).mockReturnValueOnce(true);
    render(<PwaNotifications />);
    await Promise.resolve();
    expect(register).not.toHaveBeenCalled();
  });

  it("does not register a worker in development", async () => {
    vi.stubEnv("PROD", false);
    render(<PwaNotifications />);
    await Promise.resolve();
    expect(register).not.toHaveBeenCalled();
  });
});
