import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { RouterClient } from "@tanstack/react-router/ssr/client";
import { AppProviders } from "./App";
import { createWebsiteRouter } from "./router";
import "@viritura/ui/tokens.css";
import "./index.css";
import "./marketing.css";

const router = createWebsiteRouter();
const rootElement = document.getElementById("root")!;
const app = (
  <React.StrictMode>
    <AppProviders>
      <RouterClient router={router} />
    </AppProviders>
  </React.StrictMode>
);

if (rootElement.hasChildNodes()) hydrateRoot(rootElement, app);
else {
  await router.load();
  createRoot(rootElement).render(app);
}
