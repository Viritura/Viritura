import React from "react";
import ReactDOM from "react-dom/client";
import "@viritura/ui/tokens.css";
import "@viritura/ui/reset.css";
import { OAuthConsentPage, readOAuthConsentData } from "./oauthConsent";
import "./serverPage.css";

const root = document.getElementById("root");
if (!(root instanceof HTMLElement)) {
  throw new Error("The server UI root element is missing.");
}

const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
document.documentElement.dataset.theme = preferredTheme;

const page = root.dataset.page;
if (page !== "oauth-consent") {
  throw new Error(`Unsupported server UI page: ${page ?? "unknown"}`);
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <OAuthConsentPage data={readOAuthConsentData(root)} />
  </React.StrictMode>,
);
