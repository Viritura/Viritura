export interface SiteLinks {
  app: string;
  docs: string;
  github: string;
}

function getDevelopmentEditorUrl() {
  if (typeof window === "undefined") return "http://localhost:5173";
  if (window.location.hostname.startsWith("web.")) {
    return `${window.location.protocol}//editor.${window.location.hostname.slice(4)}`;
  }
  return "http://localhost:5173";
}

export const editorUrl = import.meta.env.DEV ? getDevelopmentEditorUrl() : "https://app.viritura.com";
