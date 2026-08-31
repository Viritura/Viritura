const SENSITIVE_KEYS = ["uid", "email", "token"] as const;

export function readSensitiveLinkParam(search: Record<string, unknown>, key: (typeof SENSITIVE_KEYS)[number]): string {
  const legacy = search[key];
  if (typeof legacy === "string" && legacy.length > 0) return legacy;
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get(key) ?? "";
}

export function clearSensitiveLinkUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const key of SENSITIVE_KEYS) url.searchParams.delete(key);
  url.hash = "";
  window.history.replaceState({}, "", url.toString());
}
