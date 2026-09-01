import { useState, useEffect, useCallback, type CSSProperties } from "react";
import type { MnxDocument } from "@viritura/musicxml";
import Ajv2020 from "ajv/dist/2020.js";

const VALIDATION_LOADING_STYLE: CSSProperties = {
  color: "var(--site-text-muted)",
  background: "var(--site-paper-raised)",
  border: "1px solid var(--site-keyline)",
};
const SCHEMA_ERROR_TEXT_STYLE: CSSProperties = {
  fontSize: "var(--site-type-eyebrow-size)",
  color: "var(--site-text-muted)",
  marginTop: "0.5rem",
};
const SCHEMA_LINK_STYLE: CSSProperties = { color: "var(--site-green)" };
const MORE_ERRORS_STYLE: CSSProperties = { textAlign: "center", color: "var(--site-text-muted)" };
const REPORT_FOOTER_STYLE: CSSProperties = { marginTop: "1rem", textAlign: "center" };
const INLINE_FLEX_STYLE: CSSProperties = { display: "inline-flex" };

interface ValidationPanelProps {
  document: MnxDocument;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  loading: boolean;
  schemaError: string | null;
}

interface ValidationError {
  path: string;
  message: string;
}

const SCHEMA_URL = "https://w3c.github.io/mnx/docs/";
const SCHEMA_PATH = "/mnx-schema.json";

let cachedSchema: Record<string, unknown> | null = null;

export function ValidationPanel({ document: doc }: ValidationPanelProps) {
  const [result, setResult] = useState<ValidationResult>({
    valid: false,
    errors: [],
    loading: true,
    schemaError: null,
  });

  const validate = useCallback(async () => {
    setResult((r) => ({ ...r, loading: true }));

    try {
      if (!cachedSchema) {
        const resp = await fetch(SCHEMA_PATH);
        if (!resp.ok) throw new Error(`Failed to fetch schema: ${resp.status}`);
        cachedSchema = (await resp.json()) as Record<string, unknown>;
      }

      const ajv = new Ajv2020({ allErrors: true, strict: false });
      const validate = ajv.compile(cachedSchema);
      const valid = validate(structuredClone(doc)) as boolean;
      const errors: ValidationError[] = (validate.errors ?? []).map((e) => ({
        path: e.instancePath || "/",
        message: e.message ?? "Unknown error",
      }));

      setResult({ valid, errors, loading: false, schemaError: null });
    } catch (err) {
      setResult({
        valid: false,
        errors: [],
        loading: false,
        schemaError: err instanceof Error ? err.message : String(err),
      });
    }
  }, [doc]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled-sync effect — external source seeds local state when it changes
    validate();
  }, [validate]);

  if (result.loading) {
    return (
      <div className="validation-panel">
        <div className="validation-summary valid" style={VALIDATION_LOADING_STYLE}>
          <span className="spinner" /> Validating against MNX schema...
        </div>
      </div>
    );
  }

  if (result.schemaError) {
    return (
      <div className="validation-panel">
        <div className="validation-summary invalid">⚠️ Could not load MNX schema: {result.schemaError}</div>
        <p style={SCHEMA_ERROR_TEXT_STYLE}>
          The bundled MNX schema (<code>{SCHEMA_PATH}</code>) failed to load. It is based on the{" "}
          <a href={SCHEMA_URL} target="_blank" rel="noopener noreferrer" style={SCHEMA_LINK_STYLE}>
            MNX specification
          </a>
          . Try reloading the page.
        </p>
      </div>
    );
  }

  return (
    <div className="validation-panel">
      {result.valid ? (
        <div className="validation-summary valid">✅ Valid MNX document — passes schema validation</div>
      ) : (
        <>
          <div className="validation-summary invalid">
            ❌ {result.errors.length} validation error
            {result.errors.length !== 1 ? "s" : ""}
          </div>
          <ul className="validation-errors">
            {result.errors.slice(0, 50).map((err, i) => (
              <li key={i} className="validation-error">
                <div className="validation-error-path">{err.path}</div>
                <div className="validation-error-message">{err.message}</div>
              </li>
            ))}
            {result.errors.length > 50 && (
              <li className="validation-error" style={MORE_ERRORS_STYLE}>
                ...and {result.errors.length - 50} more errors
              </li>
            )}
          </ul>
        </>
      )}
      <div style={REPORT_FOOTER_STYLE}>
        <a
          href="https://github.com/peteryangio/viritura/issues/new?template=mnx-conversion-bug.md"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm btn-secondary"
          style={INLINE_FLEX_STYLE}
        >
          Report Conversion Bug
        </a>
      </div>
    </div>
  );
}
