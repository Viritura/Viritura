import { PASSWORD_RULES } from "../../api/passwordPolicy";

/**
 * Live per-rule pass/fail indicator rendered under a new-password input.
 * Each rule shows:
 *   - idle (gray dot) before the user types anything
 *   - pass (green ✓) once the rule matches
 *   - fail (red ✗) once the user has typed but the rule doesn't match yet
 *
 * Pattern follows the "password strength checklist" UX used by GitHub, Google,
 * 1Password, etc. — far more discoverable than a single browser tooltip on
 * native :invalid styling.
 */
interface PasswordHintsProps {
  readonly value: string;
}

export function PasswordHints({ value }: PasswordHintsProps) {
  const touched = value.length > 0;
  return (
    <ul className="auth-hint" aria-live="polite">
      {PASSWORD_RULES.map((rule) => {
        const passed = rule.test(value);
        const state = passed ? "pass" : touched ? "fail" : "idle";
        return (
          <li key={rule.id} className={`auth-hint-item is-${state}`}>
            <span className="auth-hint-icon" aria-hidden="true">
              {passed ? "✓" : touched ? "✗" : "•"}
            </span>
            <span>{rule.label}</span>
            <span className="visually-hidden">{passed ? " (met)" : " (not yet met)"}</span>
          </li>
        );
      })}
    </ul>
  );
}
