import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClickPage } from "./index";
import "@viritura/ui/tokens.css";
import "@viritura/ui/reset.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClickPage />
  </StrictMode>,
);
