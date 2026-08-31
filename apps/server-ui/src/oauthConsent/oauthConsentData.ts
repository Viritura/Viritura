interface OAuthConsentField {
  readonly name: string;
  readonly value: string;
}

export interface OAuthConsentData {
  readonly clientName: string;
  readonly action: string;
  readonly scopes: readonly string[];
  readonly fields: readonly OAuthConsentField[];
}

export function readOAuthConsentData(root: Pick<HTMLElement, "dataset">): OAuthConsentData {
  const encoded = root.dataset.payload;
  if (!encoded) throw new Error("OAuth consent data is missing.");

  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as OAuthConsentData;
}
