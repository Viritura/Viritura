const DEVELOPMENT_API_BASE_URL = "https://localhost:5001";
const PRODUCTION_API_BASE_URL = "https://api.viritura.com";

/** Resolve the configured API origin, with environment-safe defaults. */
export function resolveVirituraApiBaseUrl(configured: string | undefined, isDevelopment: boolean): string {
  const fallback = isDevelopment ? DEVELOPMENT_API_BASE_URL : PRODUCTION_API_BASE_URL;
  return (configured?.trim() || fallback).replace(/\/+$/, "");
}

/** API origin used by authentication, GitHub integration, and live collaboration. */
export function getVirituraApiBaseUrl(): string {
  return resolveVirituraApiBaseUrl(
    import.meta.env.VITE_VIRITURA_API_BASE_URL as string | undefined,
    import.meta.env.DEV,
  );
}
