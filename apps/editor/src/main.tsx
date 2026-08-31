/* eslint-disable react-refresh/only-export-components --
 * App entry point. Top-level Router / shell components are defined inline
 * here on purpose — they own the root render and aren't reused elsewhere,
 * so Fast Refresh doesn't apply. */
import React, { useState, useEffect, useRef, useCallback, useDeferredValue, useMemo, type CSSProperties } from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import "./index.css";

// isomorphic-git expects a global `Buffer` (Node API) — polyfill for browser.
if (typeof window !== "undefined" && !(window as unknown as { Buffer?: unknown }).Buffer) {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

import { WriteView } from "./components/modes/WriteView";
import { ActivityBar, type ActivityView } from "./components/ActivityBar";
import { AppShell } from "./components/AppShell";
import { PersistentJumpBarHost } from "./app/PersistentJumpBarHost";
import { PlayView } from "./components/modes/PlayView";
import { PictureView } from "./components/modes/PictureView";
import { MixerSyncBridge } from "./components/MixerSyncBridge";
import { VideoSyncBridge } from "./components/VideoSyncBridge";
import { RollView } from "./components/modes/RollView";
import { ReviewView } from "./components/modes/ReviewView";
import {
  SettingsDialog,
  closeSettings,
  openSettings,
  toggleSettings,
  useSettingsCategoryStore,
} from "./components/SettingsDialog";
import { parseMnx } from "@viritura/format";
import { setStartCenterOpen } from "./store/onboardingStore";
import { PlaybackProvider } from "@viritura/playback";
import {
  useComposedSoundProfileRegistry,
  createVstTransport,
  useAudioRenderModeStore,
  PathPromptHost,
} from "./instrumentProfiles";
import { DocumentProvider } from "./store/DocumentContext";
import { AccountProvider } from "./auth/AccountContext";
import { bootstrapTheme } from "./store/themeStore";
import { Toaster } from "sonner";
import { LiveSessionProvider } from "./live";
import { BackgroundTaskToaster } from "./app/BackgroundTaskToaster";
import { McpProposalReview, McpSessionBridge } from "./mcpSession";

// Perf overlay flag — toggled via StatusBar button at runtime.
// Can also be enabled via URL parameter ?perf=1 or console: enablePerfOverlay()

const REDIRECT_ROOT_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  fontFamily: "system-ui, sans-serif",
  backgroundColor: "#1e1e1e",
  color: "#d4d4d4",
};
const REDIRECT_TITLE_STYLE: CSSProperties = { fontSize: "var(--type-display-size)", marginBottom: "1rem" };
const REDIRECT_SUB_STYLE: CSSProperties = { marginBottom: "1.5rem", color: "var(--text-muted)" };
const REDIRECT_LINK_WRAP_STYLE: CSSProperties = { marginBottom: "2rem" };
const REDIRECT_LINK_STYLE: CSSProperties = { color: "#569cd6" };
const REDIRECT_HINT_STYLE: CSSProperties = { fontSize: "var(--type-small-size)", color: "#666" };
const REDIRECT_CODE_STYLE: CSSProperties = { color: "#ce9178" };
const APP_ROW_STYLE: CSSProperties = { display: "flex", flex: 1, minHeight: 0, overflow: "hidden" };
const APP_MAIN_COL_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};
function writeViewPaneStyle(active: boolean): CSSProperties {
  return {
    display: active ? "flex" : "none",
    flex: 1,
    minHeight: 0,
    flexDirection: "column",
    overflow: "hidden",
  };
}

/**
 * Storybook redirect — shown when navigating to the deprecated #/examples route.
 * Storybook now serves as the canonical feature showcase and test harness.
 */
function StorybookRedirect() {
  const storybookUrl = import.meta.env.DEV ? "http://localhost:6006" : "https://viritura.com/mnx/";
  useEffect(() => {
    // Auto-redirect after a short delay
    const timer = setTimeout(() => {
      window.location.href = storybookUrl;
    }, 3000);
    return () => clearTimeout(timer);
  }, [storybookUrl]);

  return (
    <div style={REDIRECT_ROOT_STYLE}>
      <h1 style={REDIRECT_TITLE_STYLE}>Score Examples have moved to Storybook</h1>
      <p style={REDIRECT_SUB_STYLE}>
        The legacy examples page has been deprecated. All score examples are now available as interactive Storybook
        stories with controls and live MNX editing.
      </p>
      <p style={REDIRECT_LINK_WRAP_STYLE}>
        Redirecting to{" "}
        <a href={storybookUrl} style={REDIRECT_LINK_STYLE}>
          MNX Renderer
        </a>{" "}
        in 3 seconds…
      </p>
      <p style={REDIRECT_HINT_STYLE}>
        Run <code style={REDIRECT_CODE_STYLE}>pnpm run storybook</code> if Storybook is not running.
      </p>
    </div>
  );
}

/** Standalone pages accessed via hash routes (dev/playground). */
function Router() {
  const [route, setRoute] = useState(window.location.hash);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Deprecated: redirect to Storybook
  if (route === "#/examples") {
    return <StorybookRedirect />;
  }
  // Main app with activity bar
  return <AppWithActivityBar />;
}

/** Main app shell with VS Code-style activity bar on the left. */
function AppWithActivityBar() {
  const [activeView, setActiveView] = useState<ActivityView>("write");
  const settingsOpen = useSettingsCategoryStore((state) => state.open);
  const [baselineMnx, setBaselineMnx] = useState<string>("");
  const [mnxJson, setMnxJson] = useState<string>("");
  const currentMnxRef = useRef<string>("");

  // Update the latest MNX whenever the document serializes. We mirror to a
  // ref for non-reactive consumers (e.g. the Review view, which snapshots
  // the JSON imperatively on view switch).
  const handleMnxChange = useCallback((next: string) => {
    currentMnxRef.current = next;
    setMnxJson(next);
  }, []);

  // Defer the parse: typing/edits commit `mnxJson` urgently for cheap UI
  // updates, but the expensive `parseMnx` only runs against the deferred
  // copy in a low-priority render. React 19's interruptible scheduler
  // replaces the hand-rolled 300ms `setTimeout` debounce that used to live
  // here. See https://react.dev/reference/react/useDeferredValue.
  const deferredMnxJson = useDeferredValue(mnxJson);
  const currentScore = useMemo<ReturnType<typeof parseMnx> | null>(() => {
    if (!deferredMnxJson) return null;
    try {
      return parseMnx(JSON.parse(deferredMnxJson));
    } catch {
      return null;
    }
  }, [deferredMnxJson]);

  // When switching to review view, snapshot the current MNX as the "modified"
  // and use the baseline (set on first load) as "original"
  const handleViewChange = useCallback(
    (view: ActivityView) => {
      if (view === "review") {
        if (!baselineMnx && currentMnxRef.current) {
          setBaselineMnx(currentMnxRef.current);
        }
      }
      setActiveView(view);
    },
    [baselineMnx],
  );

  // Set baseline on first MNX load
  const handleFirstLoad = useCallback(
    (mnxJson: string) => {
      if (!baselineMnx) {
        setBaselineMnx(mnxJson);
      }
    },
    [baselineMnx],
  );

  const prettyJson = useCallback((json: string) => {
    try {
      return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      return json;
    }
  }, []);

  // Track which parts are visible in the score view for playback filtering
  const [visiblePartIds, setVisiblePartIds] = useState<string[]>([]);

  // VirituraSounds + the user's VST instrument profiles, for Mixer selection
  // and VST-aware part→source resolution during playback.
  const soundProfileRegistry = useComposedSoundProfileRegistry();

  // Native VST transport (desktop only); undefined on the web, where every part
  // plays through SoundFont.
  const vstTransport = useMemo(() => createVstTransport(), []);

  // Desktop audio render mode (web vs native VST mixer); always "web" on the web.
  const audioRenderMode = useAudioRenderModeStore((s) => s.mode);

  return (
    <AccountProvider>
      <DocumentProvider>
        <PlaybackProvider
          score={currentScore}
          visiblePartIds={visiblePartIds}
          soundProfileRegistry={soundProfileRegistry}
          vstTransport={vstTransport}
          audioRenderMode={audioRenderMode}
        >
          <MixerSyncBridge score={currentScore} />
          <VideoSyncBridge />
          <AppShell>
            <PersistentJumpBarHost />
            {/* Activity bar + content */}
            <div style={APP_ROW_STYLE}>
              <ActivityBar
                activeView={activeView}
                onViewChange={handleViewChange}
                settingsOpen={settingsOpen}
                onToggleSettings={toggleSettings}
                onOpenAccountSettings={() => openSettings("account")}
              />
              <div style={APP_MAIN_COL_STYLE}>
                {/* Setup + Write + Engrave + Publish share Write's persistent
                    canvas, so the selected part, scroll/zoom, and view mode
                    survive the switch — only the chrome (panels/toolbar/status)
                    swaps. Setup edits the roster/layouts/signatures against
                    that same live canvas; Publish flips it to print-preview. */}
                <div
                  style={writeViewPaneStyle(
                    activeView === "setup" ||
                      activeView === "write" ||
                      activeView === "engrave" ||
                      activeView === "publish",
                  )}
                >
                  <WriteView
                    onMnxChange={handleMnxChange}
                    onFirstLoad={handleFirstLoad}
                    onVisiblePartsChange={setVisiblePartIds}
                    isActiveView={
                      activeView === "setup" ||
                      activeView === "write" ||
                      activeView === "engrave" ||
                      activeView === "publish"
                    }
                    mode={
                      activeView === "setup"
                        ? "setup"
                        : activeView === "engrave"
                          ? "engrave"
                          : activeView === "publish"
                            ? "publish"
                            : "write"
                    }
                    onOpenPublish={() => setActiveView("publish")}
                    onOpenSetup={() => setActiveView("setup")}
                    onOpenActivity={handleViewChange}
                  />
                </div>
                {activeView === "play" && <PlayView score={currentScore} />}
                {activeView === "roll" && <RollView score={currentScore} />}
                {activeView === "picture" && <PictureView score={currentScore} />}
                {activeView === "review" && (
                  // eslint-disable-next-line react-hooks/refs -- intentional ref-bag pattern; refs hold stable identity, not render-time state
                  <ReviewView originalJson={prettyJson(baselineMnx)} modifiedJson={prettyJson(currentMnxRef.current)} />
                )}
              </div>
            </div>
            <SettingsDialog
              open={settingsOpen}
              onClose={() => {
                if (closeSettings()) setStartCenterOpen(true);
              }}
            />
            <McpSessionBridge />
            <McpProposalReview />
          </AppShell>
          <LiveSessionProvider />
          <PathPromptHost />
          <Toaster position="bottom-right" richColors closeButton />
          <BackgroundTaskToaster />
        </PlaybackProvider>
      </DocumentProvider>
    </AccountProvider>
  );
}

bootstrapTheme();

// StrictMode's double render/effect pass roughly doubles dev-build cost on the
// canvas path, so it's opt-in here via VITE_STRICT=1. The protection it gave up
// is covered elsewhere: render purity by the react-hooks lint rules, effect
// cleanup by `reactStrictMode` in vitest.setup.ts.
const app =
  import.meta.env.VITE_STRICT === "1" ? (
    <React.StrictMode>
      <Router />
    </React.StrictMode>
  ) : (
    <Router />
  );

ReactDOM.createRoot(document.getElementById("root")!).render(app);
