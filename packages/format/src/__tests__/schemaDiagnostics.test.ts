import { describe, expect, it } from "vitest";
import { validateRawScore } from "../mnx/validator";

const eventPointer = "/parts/0/measures/0/sequences/0/content/0";

function scoreWith(content: unknown[], partExtensions?: unknown) {
  return {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [
      {
        ...(partExtensions === undefined ? {} : { _x: partExtensions }),
        measures: [{ sequences: [{ content }] }],
      },
    ],
  };
}

function noteEvent(alter = 0, extensions?: unknown) {
  return {
    duration: { base: "quarter" },
    notes: [
      {
        pitch: { step: "C", octave: 4, alter },
        ...(extensions === undefined ? {} : { _x: extensions }),
      },
    ],
  };
}

function errorsFor(document: unknown) {
  const result = validateRawScore(document);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected schema validation to fail");
  return result.errors;
}

describe("actionable MNX schema diagnostics", () => {
  it("accepts ordinary events without a type and namespaced third-party data", () => {
    const document = scoreWith([noteEvent(0, { exampleApp: { string: 1, fret: 0 } })], {
      exampleApp: { capo: 0, tuning: [40, 45, 50, 55, 59, 64] },
    });
    const original = structuredClone(document);
    expect(validateRawScore(document).ok).toBe(true);
    expect(document).toEqual(original);
  });

  it("reports only the real extension and pitch errors, not alternative content requirements", () => {
    const errors = errorsFor(scoreWith([noteEvent(0.5, { string: 1, fret: 0 })], { capo: 0 }));
    expect(errors).toHaveLength(4);
    expect(errors.map((error) => error.pointer)).toEqual([
      "/parts/0/_x/capo",
      `${eventPointer}/notes/0/_x/string`,
      `${eventPointer}/notes/0/_x/fret`,
      `${eventPointer}/notes/0/pitch/alter`,
    ]);
    expect(errors[0]?.message).toContain("vendor namespaces");
    expect(errors[0]?.message).toContain("_x: { yourApp:");
    expect(errors[3]?.message).toContain("fractional microtonal alterations");
    expect(errors.every((error) => error.keyword === "type")).toBe(true);
  });

  it("names invalid properties on tuplets and their nested events without unrelated branch errors", () => {
    const document = scoreWith([
      {
        type: "tuplet",
        inner: { duration: { base: "quarter" }, multiple: 1 },
        outer: { duration: { base: "quarter" }, multiple: 1 },
        content: [{ ...noteEvent(), orient: "below" }],
        orient: "above",
      },
    ]);
    const errors = errorsFor(document);
    expect(errors).toHaveLength(2);
    expect(errors).toEqual(
      expect.arrayContaining([
        {
          pointer: eventPointer,
          keyword: "unevaluatedProperties",
          message: "must NOT have unrecognized property 'orient'",
        },
        {
          pointer: `${eventPointer}/content/0`,
          keyword: "unevaluatedProperties",
          message: "must NOT have unrecognized property 'orient'",
        },
      ]),
    );
  });

  it("keeps parent requirements alongside deeply nested event failures", () => {
    const errors = errorsFor(
      scoreWith([
        {
          type: "tuplet",
          outer: { duration: { base: "quarter" }, multiple: 1 },
          content: [
            {
              type: "tuplet",
              inner: { duration: { base: "quarter" }, multiple: 1 },
              outer: { duration: { base: "quarter" }, multiple: 1 },
              content: [noteEvent(0.5)],
            },
          ],
        },
      ]),
    );
    expect(errors).toHaveLength(2);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pointer: eventPointer,
          keyword: "required",
          message: "must have required property 'inner'",
        }),
        expect.objectContaining({
          pointer: `${eventPointer}/content/0/content/0/notes/0/pitch/alter`,
          keyword: "type",
        }),
      ]),
    );
  });

  it("does not accept a tuplet where grace content requires an event", () => {
    const errors = errorsFor(
      scoreWith([
        {
          type: "grace",
          content: [
            {
              type: "tuplet",
              inner: { duration: { base: "quarter" }, multiple: 1 },
              outer: { duration: { base: "quarter" }, multiple: 1 },
              content: [noteEvent()],
            },
          ],
        },
      ]),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        pointer: `${eventPointer}/content/0/type`,
        keyword: "const",
        message: 'must equal "event"',
      }),
    );
  });

  it("diagnoses grace and multi-note tremolo event failures in context", () => {
    const errors = errorsFor(
      scoreWith([
        { type: "grace", content: [noteEvent(0.5)] },
        {
          type: "tremolo",
          marks: 2,
          outer: { duration: { base: "quarter" }, multiple: 1 },
          content: [noteEvent(0.5), noteEvent()],
        },
      ]),
    );
    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.pointer)).toEqual([
      `${eventPointer}/content/0/notes/0/pitch/alter`,
      "/parts/0/measures/0/sequences/0/content/1/content/0/notes/0/pitch/alter",
    ]);
  });

  it("reports the space duration schema rather than the ordinary event schema", () => {
    expect(errorsFor(scoreWith([{ type: "space", duration: { base: "quarter" } }]))).toEqual([
      { pointer: `${eventPointer}/duration`, keyword: "type", message: "must be array" },
    ]);
  });

  it.each(["unknown", "constructor", "__proto__", 7])("explains unsupported content type %s", (type) => {
    expect(errorsFor(scoreWith([{ ...noteEvent(), type }]))).toEqual([
      {
        pointer: `${eventPointer}/type`,
        keyword: "enum",
        message: expect.stringContaining("'event' (or omitted)"),
      },
    ]);
  });

  it("still rejects malformed content, durations and missing event fields", () => {
    expect(errorsFor(scoreWith([null]))).toContainEqual(
      expect.objectContaining({ pointer: eventPointer, keyword: "type" }),
    );
    expect(errorsFor(scoreWith([{}]))).toEqual([
      {
        pointer: eventPointer,
        keyword: "required",
        message: "must have required property 'duration'",
      },
    ]);
    expect(errorsFor(scoreWith([{ duration: "quarter", rest: {} }]))).toEqual([
      {
        pointer: `${eventPointer}/duration`,
        keyword: "type",
        message: "must be object",
      },
    ]);
  });

  it("preserves independent document errors and escapes vendor pointer tokens", () => {
    const document = { ...scoreWith([noteEvent(0, { "my/app~name": 1 })]), unexpected: true };
    const errors = errorsFor(document);
    expect(errors).toHaveLength(2);
    expect(errors).toContainEqual(
      expect.objectContaining({ pointer: `${eventPointer}/notes/0/_x/my~1app~0name`, keyword: "type" }),
    );
    expect(errors).toContainEqual({
      pointer: "(root)",
      keyword: "unevaluatedProperties",
      message: "must NOT have unrecognized property 'unexpected'",
    });
  });
});
