const SENSITIVE_SEARCH_KEYS = ["uid", "email", "token"] as const;

type SensitiveSearchKey = (typeof SENSITIVE_SEARCH_KEYS)[number];

function readParam(searchParams: URLSearchParams, key: SensitiveSearchKey): string {
  return searchParams.get(key) ?? "";
}

export interface SensitiveSearchParams {
  uid: string;
  email: string;
  token: string;
}

export function readSensitiveSearchParams(searchParams: URLSearchParams): SensitiveSearchParams {
  return {
    uid: readParam(searchParams, "uid"),
    email: readParam(searchParams, "email"),
    token: readParam(searchParams, "token"),
  };
}
