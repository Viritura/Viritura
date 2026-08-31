import { describe, expect, it } from "vitest";
import { parsePlayerRoutingLabel } from "./routingText";

describe("parsePlayerRoutingLabel", () => {
  it.each([
    ["1", { kind: "players", players: [1] }],
    ["1.", { kind: "players", players: [1] }],
    ["I", { kind: "players", players: [1] }],
    ["i.", { kind: "players", players: [1] }],
    ["2", { kind: "players", players: [2] }],
    ["II.", { kind: "players", players: [2] }],
    ["3.", { kind: "players", players: [3] }],
    ["III.", { kind: "players", players: [3] }],
    ["1, 2", { kind: "players", players: [1, 2] }],
    ["1/2", { kind: "players", players: [1, 2] }],
    ["I.II.", { kind: "players", players: [1, 2] }],
    [" i & II ", { kind: "players", players: [1, 2] }],
    ["1, II.", { kind: "players", players: [1, 2] }],
    ["a2", { kind: "all", count: 2 }],
    ["A 2", { kind: "all", count: 2 }],
    ["a. 2", { kind: "all", count: 2 }],
    ["à 2", { kind: "all", count: 2 }],
    ["a3", { kind: "all", count: 3 }],
    ["A. 3.", { kind: "all", count: 3 }],
  ])("parses %j", (text, expected) => {
    expect(parsePlayerRoutingLabel(text)).toEqual(expected);
  });

  it.each([
    "",
    "dolce",
    "poco a poco",
    "a tempo",
    "div.",
    "solo",
    "tutti",
    "I love this",
    "12",
    "IV.",
    "1 2",
    "a4",
    "a 2 poco",
    "I..II.",
    "III. espressivo",
  ])("rejects non-routing text %j", (text) => {
    expect(parsePlayerRoutingLabel(text)).toBeNull();
  });

  it("keeps dotted combined and single Roman labels unambiguous", () => {
    expect(parsePlayerRoutingLabel("I.II.")).toEqual({ kind: "players", players: [1, 2] });
    expect(parsePlayerRoutingLabel("III.")).toEqual({ kind: "players", players: [3] });
  });
});
