import { PromptDialog } from "@viritura/ui";
import { settlePathPrompt, usePathPromptStore } from "./pathPrompt";

/**
 * Renders the pending {@link requestPathInput} request.
 *
 * Mounted once at the app root rather than beside any one picker: the browser
 * host bridge is reached from several surfaces (slot bindings, scan folders,
 * default reverb, the FX chain), and each would otherwise need its own copy.
 */
export function PathPromptHost() {
  const request = usePathPromptStore((s) => s.request);
  if (!request) return null;

  return (
    <PromptDialog
      open
      title={request.title}
      description={request.description}
      placeholder={request.placeholder}
      label={request.title}
      confirmLabel="Use path"
      allowEmpty={false}
      onSubmit={(value) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) return false;
        // PromptDialog calls `onClose` after a successful submit, so the
        // cancel path below also runs. `settlePathPrompt` clears the request
        // as it resolves, so that second call is a no-op rather than
        // overwriting the path with a cancellation.
        settlePathPrompt(trimmed);
      }}
      onClose={() => settlePathPrompt(null)}
    />
  );
}
