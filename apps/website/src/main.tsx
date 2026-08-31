import React from "react";
import ReactDOM from "react-dom/client";
import { TooltipPrimitives } from "@viritura/ui";
import { App } from "./App";
import "@viritura/ui/tokens.css";
import "./index.css";
import "./marketing.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Hoisted Tooltip provider mirrors AppShell so every primitive that uses
        `withTooltip` works without per-instance providers. */}
    <TooltipPrimitives.Provider delayDuration={400} skipDelayDuration={100}>
      <App />
    </TooltipPrimitives.Provider>
  </React.StrictMode>,
);
