/**
 * Mirrors the ASP.NET Core Identity password policy configured in
 * server/Viritura.Infrastructure/InfrastructureServiceCollectionExtensions.cs:
 *
 *   options.Password.RequiredLength = 12;
 *   // RequireDigit / RequireLowercase / RequireUppercase / RequireNonAlphanumeric default to true
 *
 * Each rule exposes a `test` predicate so the UI can render per-rule pass/fail
 * indicators as the user types, plus a static `pattern` regex string and `title`
 * summary for native HTML5 form validation (and for the browser's submit blocker
 * if JS is disabled). Update both sides together if the server policy changes.
 */
export const PASSWORD_MIN_LENGTH = 12;

// Lookaheads enforce at least one lowercase, uppercase, digit, and non-alphanumeric.
export const PASSWORD_PATTERN = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{12,}$";

export const PASSWORD_TITLE =
  "At least 12 characters, including an uppercase letter, a lowercase letter, a digit, and a symbol.";

export interface PasswordRule {
  readonly id: string;
  readonly label: string;
  readonly test: (value: string) => boolean;
}

export const PASSWORD_RULES: ReadonlyArray<PasswordRule> = [
  { id: "length", label: "At least 12 characters", test: (v) => v.length >= PASSWORD_MIN_LENGTH },
  { id: "upper", label: "An uppercase letter (A–Z)", test: (v) => /[A-Z]/.test(v) },
  { id: "lower", label: "A lowercase letter (a–z)", test: (v) => /[a-z]/.test(v) },
  { id: "digit", label: "A digit (0–9)", test: (v) => /\d/.test(v) },
  { id: "symbol", label: "A symbol (e.g. !@#$%)", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function isPasswordCompliant(value: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(value));
}
