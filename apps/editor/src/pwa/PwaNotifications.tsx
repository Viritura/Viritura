import { useEffect } from "react";
import { toast } from "sonner";
import { isDesktopHost } from "../instrumentProfiles";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaNotifications(): null {
  useEffect(() => {
    if (!import.meta.env.PROD || isDesktopHost() || !("serviceWorker" in navigator)) return;
    let disposed = false;
    let updateTimer: ReturnType<typeof setInterval> | undefined;
    const installed = window.matchMedia("(display-mode: standalone)").matches;
    const onInstallPrompt = (event: Event): void => {
      if (installed) return;
      event.preventDefault();
      const prompt = event as InstallPromptEvent;
      toast.info("Install Viritura for a separate app window and local document opening.", {
        id: "pwa-install",
        duration: 15000,
        action: {
          label: "Install Viritura",
          onClick: () => {
            void (async () => {
              await prompt.prompt();
              await prompt.userChoice;
            })().catch((error: unknown) => {
              console.error("PWA installation failed:", error);
              toast.error("Could not install Viritura. Try your browser's Install app command.");
            });
          },
        },
      });
    };
    const onInstalled = (): void => {
      toast.dismiss("pwa-install");
      toast.success("Viritura installed");
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    void import("workbox-window")
      .then(async ({ Workbox }) => {
        if (disposed) return;
        const worker = new Workbox("/sw.js", { scope: "/" });
        const completedInstallations = new WeakSet<ServiceWorker>();
        worker.addEventListener("installed", (event) => {
          if (event.sw) completedInstallations.add(event.sw);
          if (!disposed && !event.isUpdate) {
            toast.success("Viritura is ready for offline editing and playback.");
          }
        });
        worker.addEventListener("waiting", () => {
          if (!disposed) {
            toast.info("A Viritura update is ready. Save your work and close all Viritura windows to apply it.", {
              id: "pwa-update",
              duration: Infinity,
            });
          }
        });
        worker.addEventListener("redundant", (event) => {
          if (!disposed && (!event.sw || !completedInstallations.has(event.sw))) {
            console.error("Viritura service worker installation failed:", event.sw?.scriptURL);
            toast.error("Offline setup or update failed. Reconnect and reopen Viritura to retry.");
          }
        });
        const registration = await worker.register({ immediate: true });
        if (!registration || disposed) return;
        if (registration.active) completedInstallations.add(registration.active);
        if (registration.waiting) completedInstallations.add(registration.waiting);
        updateTimer = setInterval(
          () => {
            if (navigator.onLine) {
              void registration.update().catch((error: unknown) => {
                console.warn("Could not check for a Viritura update:", error);
              });
            }
          },
          60 * 60 * 1000,
        );
      })
      .catch((error: unknown) => {
        console.error("Viritura offline setup failed:", error);
        toast.error("Offline setup failed. Viritura can still be used online.");
      });
    return () => {
      disposed = true;
      if (updateTimer) clearInterval(updateTimer);
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}
