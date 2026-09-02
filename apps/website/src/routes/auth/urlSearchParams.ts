type SensitiveSearchKey = "uid" | "email" | "token";

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
