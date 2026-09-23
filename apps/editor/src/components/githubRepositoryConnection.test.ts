import { describe, expect, it } from "vitest";
import { describeCompatibility, parseRepositoryInput, validateRepositoryInput } from "./githubRepositoryConnection";

describe("GitHub repository connection", () => {
  it.each([
    ["viritura/quartet", { owner: "viritura", name: "quartet" }],
    ["https://github.com/viritura/quartet", { owner: "viritura", name: "quartet" }],
    ["https://github.com/viritura/quartet.git", { owner: "viritura", name: "quartet" }],
    ["git@github.com:viritura/quartet.git", { owner: "viritura", name: "quartet" }],
  ])("parses repository input %s", (input, expected) => {
    expect(parseRepositoryInput(input)).toEqual(expected);
    expect(validateRepositoryInput(input)).toBeNull();
  });

  it.each(["quartet", "github.com/viritura/quartet/extra", "https://example.com/viritura/quartet"])(
    "rejects invalid repository input %s",
    (input) => {
      expect(parseRepositoryInput(input)).toBeNull();
      expect(validateRepositoryInput(input)).not.toBeNull();
    },
  );

  it("allows empty and related-behind histories", () => {
    expect(describeCompatibility({ kind: "empty", branch: "main", localAhead: 2, remoteAhead: 0 }).safe).toBe(true);
    expect(describeCompatibility({ kind: "remote-behind", branch: "main", localAhead: 2, remoteAhead: 0 }).safe).toBe(
      true,
    );
  });

  it("blocks remote-ahead, diverged, and unrelated histories", () => {
    for (const kind of ["remote-ahead", "diverged", "unrelated"] as const) {
      expect(describeCompatibility({ kind, branch: "main", localAhead: 0, remoteAhead: 1 }).safe).toBe(false);
    }
  });
});
